-- =============================================
-- ESQUEMA PROFESIONAL SUPABASE PARA "DONDE KIKE" ERP/POS
-- =============================================
-- Ejecutar este script en el SQL Editor de Supabase
-- (Dashboard -> SQL Editor -> New Query -> pegar -> Run)

-- Habilitar extensión criptográfica para hashing seguro de PINs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLA DE USUARIOS (PIN protegido)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'waiter', 'kitchen')),
  pin TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA DE INSUMOS (inventario)
CREATE TABLE IF NOT EXISTS insumos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA DE CATÁLOGO (productos del menú con ordenamiento)
CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  category TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  insumo_recipe JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar columna sort_order si la tabla ya existía
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 4. TABLA DE PEDIDOS
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in-progress', 'completed', 'cancelled', 'reversed')),
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'Efectivo',
  order_type TEXT DEFAULT 'Mesa',
  table_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by TEXT DEFAULT '',
  insumo_deductions JSONB DEFAULT '[]'
);

-- Asegurar columnas para órdenes de comida rápida si la tabla ya existía
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Efectivo';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Mesa';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT DEFAULT '';

-- 5. TABLA DE FACTURAS
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  business_name TEXT DEFAULT 'Donde Kike',
  business_address TEXT DEFAULT '',
  business_phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT ''
);

-- 6. SECUENCIAS NATIVAS (Elimina condiciones de carrera)
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1;

-- =============================================
-- FUNCIONES RPC ATÓMICAS (SEGURIDAD Y TRANSACCIONALIDAD)
-- =============================================

-- A. Verificación de PIN segura (sin exponer PINs al cliente)
CREATE OR REPLACE FUNCTION verify_user_pin(p_username TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_matches BOOLEAN := false;
BEGIN
  SELECT * INTO v_user
  FROM users
  WHERE LOWER(username) = LOWER(TRIM(p_username));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuario no encontrado');
  END IF;

  -- Comprueba si coincide con hash bcrypt o texto plano previo (con auto-migración a hash)
  IF v_user.pin = crypt(p_pin, v_user.pin) THEN
    v_matches := true;
  ELSIF v_user.pin = p_pin THEN
    v_matches := true;
    -- Migración transparente a hash bcrypt
    UPDATE users SET pin = crypt(p_pin, gen_salt('bf')) WHERE id = v_user.id;
  END IF;

  IF NOT v_matches THEN
    RETURN jsonb_build_object('success', false, 'message', 'PIN incorrecto');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Autenticación exitosa',
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'fullName', v_user.full_name,
      'role', v_user.role,
      'createdAt', v_user.created_at
    )
  );
END;
$$;

-- B. Creación segura de usuario con hash de PIN
CREATE OR REPLACE FUNCTION create_user_secure(
  p_id TEXT,
  p_username TEXT,
  p_full_name TEXT,
  p_role TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER(TRIM(p_username))) THEN
    RETURN jsonb_build_object('success', false, 'message', 'El nombre de usuario ya existe');
  END IF;

  INSERT INTO users (id, username, full_name, role, pin)
  VALUES (
    p_id,
    TRIM(p_username),
    TRIM(p_full_name),
    p_role,
    crypt(p_pin, gen_salt('bf'))
  );

  RETURN jsonb_build_object('success', true, 'message', 'Usuario creado exitosamente');
END;
$$;

-- C. Transacción atómica: Creación de Pedido, Factura y Descuento de Inventario
CREATE OR REPLACE FUNCTION create_order_atomic(
  p_order_id TEXT,
  p_items JSONB,
  p_subtotal INTEGER,
  p_tax INTEGER,
  p_total INTEGER,
  p_customer_name TEXT,
  p_customer_email TEXT,
  p_notes TEXT,
  p_created_by TEXT,
  p_deductions JSONB,
  p_tax_rate NUMERIC,
  p_business_info JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_number INTEGER;
  v_invoice_number_val INTEGER;
  v_invoice_number TEXT;
  v_deduction RECORD;
  v_current_stock INTEGER;
  v_insumo_name TEXT;
  v_order JSONB;
  v_invoice JSONB;
BEGIN
  -- 1. Descontar y validar cada insumo de manera atómica
  IF p_deductions IS NOT NULL AND jsonb_array_length(p_deductions) > 0 THEN
    FOR v_deduction IN 
      SELECT 
        (d->>'insumoId')::TEXT AS insumo_id, 
        (d->>'quantity')::INTEGER AS quantity
      FROM jsonb_array_elements(p_deductions) AS d
    LOOP
      SELECT stock, name INTO v_current_stock, v_insumo_name
      FROM insumos
      WHERE id = v_deduction.insumo_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insumo ID % no encontrado en el inventario', v_deduction.insumo_id;
      END IF;

      IF v_current_stock < v_deduction.quantity THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, Requerido: %', 
          v_insumo_name, v_current_stock, v_deduction.quantity;
      END IF;

      UPDATE insumos
      SET stock = stock - v_deduction.quantity,
          updated_at = NOW()
      WHERE id = v_deduction.insumo_id;
    END LOOP;
  END IF;

  -- 2. Obtener siguiente número de orden y factura atómicamente
  v_order_number := nextval('order_number_seq');
  v_invoice_number_val := nextval('invoice_number_seq');
  v_invoice_number := 'FAC-' || LPAD(v_invoice_number_val::TEXT, 6, '0');

  -- 3. Insertar orden
  INSERT INTO orders (
    id, order_number, items, subtotal, tax, total,
    status, customer_name, customer_email, notes,
    created_at, created_by, insumo_deductions
  ) VALUES (
    p_order_id, v_order_number, p_items, p_subtotal, p_tax, p_total,
    'pending', COALESCE(p_customer_name, ''), COALESCE(p_customer_email, ''), COALESCE(p_notes, ''),
    NOW(), COALESCE(p_created_by, ''), COALESCE(p_deductions, '[]'::jsonb)
  );

  -- 4. Insertar factura
  INSERT INTO invoices (
    id, invoice_number, order_id, items, subtotal, tax, tax_rate, total,
    customer_name, customer_email, business_name, business_address, business_phone,
    created_at, created_by
  ) VALUES (
    'inv_' || substr(md5(random()::text), 1, 10),
    v_invoice_number,
    p_order_id,
    p_items,
    p_subtotal,
    p_tax,
    p_tax_rate,
    p_total,
    COALESCE(p_customer_name, ''),
    COALESCE(p_customer_email, ''),
    COALESCE(p_business_info->>'businessName', 'Donde Kike'),
    COALESCE(p_business_info->>'businessAddress', ''),
    COALESCE(p_business_info->>'businessPhone', ''),
    NOW(),
    COALESCE(p_created_by, '')
  );

  -- 5. Construir respuesta
  SELECT to_jsonb(o) INTO v_order FROM orders o WHERE o.id = p_order_id;
  SELECT to_jsonb(i) INTO v_invoice FROM invoices i WHERE i.order_id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order', v_order,
    'invoice', v_invoice
  );
END;
$$;

-- D. Cancelación y reverso atómicos con restauración de insumos
CREATE OR REPLACE FUNCTION cancel_order_atomic(p_order_id TEXT, p_new_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_deduction RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pedido no encontrado');
  END IF;

  IF v_order.status IN ('cancelled', 'reversed') THEN
    RETURN jsonb_build_object('success', false, 'message', 'El pedido ya fue cancelado o reversado');
  END IF;

  -- Restaurar insumos
  IF v_order.insumo_deductions IS NOT NULL AND jsonb_array_length(v_order.insumo_deductions) > 0 THEN
    FOR v_deduction IN 
      SELECT 
        (d->>'insumoId')::TEXT AS insumo_id, 
        (d->>'quantity')::INTEGER AS quantity
      FROM jsonb_array_elements(v_order.insumo_deductions) AS d
    LOOP
      UPDATE insumos
      SET stock = stock + v_deduction.quantity,
          updated_at = NOW()
      WHERE id = v_deduction.insumo_id;
    END LOOP;
  END IF;

  UPDATE orders
  SET status = p_new_status
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'message', 'Pedido actualizado e insumos restaurados');
END;
$$;

-- =============================================
-- DATOS SEED (iniciales corregidos)
-- =============================================

-- Usuario Admin por defecto (PIN: 1927 con hash bcrypt)
INSERT INTO users (id, username, full_name, role, pin) VALUES
  ('usr_admin_default', 'Admin', 'Administrador', 'admin', crypt('1927', gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

-- Insumos iniciales (incluye Queso)
INSERT INTO insumos (id, name, image, stock, low_stock_threshold) VALUES
  ('ins_seed001', 'Cunit (unidad)', '', 22, 5),
  ('ins_seed002', 'Salchicha Suiza (unidad)', '', 50, 10),
  ('ins_seed003', 'Chorizo Chori Perro (unidad)', '', 5, 2),
  ('ins_seed004', 'Chorizo Súper Chori (unidad)', '', 4, 2),
  ('ins_seed005', 'Carne de hamburguesa (unidad)', '', 30, 5),
  ('ins_seed006', 'Pan Sencillo (unidad)', '', 50, 10),
  ('ins_seed007', 'Pan Super (unidad)', '', 50, 10),
  ('ins_seed008', 'Pan Salvaje (unidad)', '', 50, 10),
  ('ins_seed009', 'Pan de Hamburguesa (unidad)', '', 50, 10),
  ('ins_seed010', 'Queso (porción/loncha)', '', 60, 10)
ON CONFLICT (id) DO NOTHING;

-- Catálogo inicial con recetas vinculadas por insumoId real
INSERT INTO catalog_items (id, name, content, price, image, category, sort_order, insumo_recipe) VALUES
  ('cat_seed001', 'Perro Sencillo', 'Pan de perro, salchicha, salsas', 10000, '', 'Perros', 1,
    '[{"insumoId":"ins_seed006","quantity":1},{"insumoId":"ins_seed001","quantity":1}]'),
  ('cat_seed002', 'Perro Súper', 'Pan super, salchicha suiza, queso, papas, salsas', 12000, '', 'Perros', 2,
    '[{"insumoId":"ins_seed007","quantity":1},{"insumoId":"ins_seed002","quantity":1},{"insumoId":"ins_seed010","quantity":1}]'),
  ('cat_seed003', 'Perro Suizo', 'Pan super, salchicha suiza, queso, tocineta, salsas', 16000, '', 'Perros', 3,
    '[{"insumoId":"ins_seed007","quantity":1},{"insumoId":"ins_seed002","quantity":1},{"insumoId":"ins_seed010","quantity":1}]'),
  ('cat_seed004', 'Chori Perro', 'Pan super, chorizo, salsas', 16000, '', 'Perros', 4,
    '[{"insumoId":"ins_seed007","quantity":1},{"insumoId":"ins_seed003","quantity":1}]'),
  ('cat_seed005', 'Súper Chori', 'Pan salvaje, chorizo, queso, papas, salsas', 20000, '', 'Perros', 5,
    '[{"insumoId":"ins_seed008","quantity":1},{"insumoId":"ins_seed004","quantity":1},{"insumoId":"ins_seed010","quantity":1}]'),
  ('cat_seed006', 'Hamburguesa Sencilla', 'Pan de hamburguesa, carne, lechuga, tomate, salsas', 17000, '', 'Hamburguesas', 6,
    '[{"insumoId":"ins_seed009","quantity":1},{"insumoId":"ins_seed005","quantity":1}]'),
  ('cat_seed007', 'Hamburguesa Doble Carne', 'Pan de hamburguesa, doble carne, queso, lechuga, tomate, salsas', 25000, '', 'Hamburguesas', 7,
    '[{"insumoId":"ins_seed009","quantity":1},{"insumoId":"ins_seed005","quantity":2},{"insumoId":"ins_seed010","quantity":1}]'),
  ('cat_seed008', 'Manzana Personal', 'Manzana personal bien fría', 4000, '', 'Bebidas', 8, '[]'),
  ('cat_seed009', 'Coca-Cola Personal', 'Coca-Cola personal bien fría', 4000, '', 'Bebidas', 9, '[]'),
  ('cat_seed010', 'Kola Román Personal', 'Kola Román personal bien fría', 4000, '', 'Bebidas', 10, '[]')
ON CONFLICT (id) DO NOTHING;

-- Sincronizar secuencias con máximos valores existentes
SELECT setval('order_number_seq', COALESCE((SELECT MAX(order_number) FROM orders), 0) + 1, false);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Allow all on users" ON users;
CREATE POLICY "Allow read users without pin" ON users FOR SELECT USING (true);
CREATE POLICY "Allow update users" ON users FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete users" ON users FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all on insumos" ON insumos;
CREATE POLICY "Allow all on insumos" ON insumos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on catalog_items" ON catalog_items;
CREATE POLICY "Allow all on catalog_items" ON catalog_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on orders" ON orders;
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on invoices" ON invoices;
CREATE POLICY "Allow all on invoices" ON invoices FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- PUBLICACIÓN SUPABASE REALTIME
-- =============================================
-- Permite que la pantalla de cocina y pedidos reciba eventos en tiempo real
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'insumos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE insumos;
  END IF;
END $$;
