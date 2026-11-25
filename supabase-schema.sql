-- =============================================
-- ESQUEMA PROFESIONAL SUPABASE PARA "DONDE KIKE" POS
-- =============================================
-- Ejecutar en el SQL Editor de Supabase (idempotente).
-- Nota de producción: para despliegues multi-usuario abiertos a internet,
-- habilitar Supabase Auth (JWT con rol) para endurecer políticas RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLA DE USUARIOS (PIN protegido con bcrypt)
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
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA DE CATÁLOGO (productos del menú)
CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  insumo_recipe JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 4. TABLA DE PEDIDOS
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in-progress', 'completed', 'cancelled', 'reversed')),
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'Efectivo',
  order_type TEXT DEFAULT 'Comer Aquí',
  table_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by TEXT DEFAULT '',
  insumo_deductions JSONB DEFAULT '[]'
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'Efectivo';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Comer Aquí';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT DEFAULT '';

-- 5. TABLA DE FACTURAS / COMPROBANTES
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  tax INTEGER NOT NULL DEFAULT 0 CHECK (tax >= 0),
  tax_rate NUMERIC NOT NULL DEFAULT 0,
  total INTEGER NOT NULL CHECK (total >= 0),
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  business_name TEXT DEFAULT 'Donde Kike',
  business_address TEXT DEFAULT '',
  business_phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT ''
);

-- 6. SECUENCIAS NATIVAS
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1;

-- =============================================
-- FUNCIONES RPC ATÓMICAS Y SEGURAS
-- =============================================

-- A. Verificación segura de PIN (bcrypt sin exponer columna pin al cliente)
CREATE OR REPLACE FUNCTION verify_user_pin(p_username TEXT, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_matches BOOLEAN := false;
BEGIN
  IF p_username IS NULL OR LENGTH(TRIM(p_username)) = 0 OR p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Credenciales con formato inválido');
  END IF;

  SELECT * INTO v_user
  FROM users
  WHERE LOWER(username) = LOWER(TRIM(p_username));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuario no encontrado');
  END IF;

  IF v_user.pin = crypt(p_pin, v_user.pin) THEN
    v_matches := true;
  ELSIF v_user.pin = p_pin THEN
    v_matches := true;
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

-- B. Creación segura de usuario con validación y hash bcrypt
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
SET search_path = public, extensions
AS $$
DECLARE
  v_username TEXT := TRIM(COALESCE(p_username, ''));
  v_full_name TEXT := TRIM(COALESCE(p_full_name, ''));
BEGIN
  IF LENGTH(v_full_name) < 3 OR v_username !~ '^[a-zA-Z0-9._-]{3,30}$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nombre o usuario con formato inválido');
  END IF;

  IF p_role NOT IN ('admin', 'waiter', 'kitchen') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Rol de usuario no permitido');
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'message', 'El PIN debe contener 4 dígitos numéricos');
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE LOWER(username) = LOWER(v_username)) THEN
    RETURN jsonb_build_object('success', false, 'message', 'El nombre de usuario ya existe');
  END IF;

  INSERT INTO users (id, username, full_name, role, pin)
  VALUES (
    p_id,
    v_username,
    v_full_name,
    p_role,
    crypt(p_pin, gen_salt('bf'))
  );

  RETURN jsonb_build_object('success', true, 'message', 'Usuario creado exitosamente');
END;
$$;

-- C. Transacción atómica: Pedido, Comprobante y Descuento de Inventario
-- Eliminar sobrecarga anterior de 12 parámetros para evitar ambigüedad PGRST203
DROP FUNCTION IF EXISTS create_order_atomic(
  TEXT, JSONB, INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, JSONB
);

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
  p_business_info JSONB,
  p_payment_method TEXT DEFAULT 'Efectivo',
  p_order_type TEXT DEFAULT 'Comer Aquí',
  p_table_number TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  IF p_subtotal < 0 OR p_tax < 0 OR p_total < 0 THEN
    RAISE EXCEPTION 'Los montos del pedido no pueden ser negativos';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe contener al menos un producto';
  END IF;

  -- 1. Descontar y validar insumos en orden determinista (previene deadlocks)
  IF p_deductions IS NOT NULL AND jsonb_typeof(p_deductions) = 'array' AND jsonb_array_length(p_deductions) > 0 THEN
    FOR v_deduction IN
      SELECT
        (d->>'insumoId')::TEXT AS insumo_id,
        (d->>'quantity')::INTEGER AS quantity
      FROM jsonb_array_elements(p_deductions) AS d
      ORDER BY (d->>'insumoId')::TEXT ASC
    LOOP
      IF v_deduction.quantity IS NULL OR v_deduction.quantity <= 0 THEN
        RAISE EXCEPTION 'Cantidad de descuento de insumo inválida';
      END IF;

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

  -- 2. Obtener correlativos atómicamente
  v_order_number := nextval('order_number_seq');
  v_invoice_number_val := nextval('invoice_number_seq');
  v_invoice_number := 'FAC-' || LPAD(v_invoice_number_val::TEXT, 6, '0');

  -- 3. Insertar orden
  INSERT INTO orders (
    id, order_number, items, subtotal, tax, total,
    status, customer_name, customer_email, payment_method, order_type, table_number, notes,
    created_at, created_by, insumo_deductions
  ) VALUES (
    p_order_id, v_order_number, p_items, p_subtotal, p_tax, p_total,
    'pending', COALESCE(p_customer_name, ''), COALESCE(p_customer_email, ''),
    COALESCE(NULLIF(TRIM(p_payment_method), ''), 'Efectivo'),
    COALESCE(NULLIF(TRIM(p_order_type), ''), 'Comer Aquí'),
    COALESCE(TRIM(p_table_number), ''),
    COALESCE(p_notes, ''),
    NOW(), COALESCE(p_created_by, ''), COALESCE(p_deductions, '[]'::jsonb)
  );

  -- 4. Insertar comprobante con identificador aleatorio criptográfico
  INSERT INTO invoices (
    id, invoice_number, order_id, items, subtotal, tax, tax_rate, total,
    customer_name, customer_email, business_name, business_address, business_phone,
    created_at, created_by
  ) VALUES (
    'inv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
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

  SELECT to_jsonb(o) INTO v_order FROM orders o WHERE o.id = p_order_id;
  SELECT to_jsonb(i) INTO v_invoice FROM invoices i WHERE i.order_id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order', v_order,
    'invoice', v_invoice
  );
END;
$$;

-- D. Cancelación y reverso atómicos con validación de transición y restauración de stock
CREATE OR REPLACE FUNCTION cancel_order_atomic(p_order_id TEXT, p_new_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_deduction RECORD;
BEGIN
  IF p_new_status NOT IN ('cancelled', 'reversed') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Estado destino no permitido');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pedido no encontrado');
  END IF;

  IF v_order.status IN ('cancelled', 'reversed') THEN
    RETURN jsonb_build_object('success', false, 'message', 'El pedido ya fue cancelado o reversado');
  END IF;

  IF p_new_status = 'cancelled' AND v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Un pedido despachado solo puede reversarse');
  END IF;

  IF p_new_status = 'reversed' AND v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solo se pueden reversar pedidos despachados');
  END IF;

  IF v_order.insumo_deductions IS NOT NULL
     AND jsonb_typeof(v_order.insumo_deductions) = 'array'
     AND jsonb_array_length(v_order.insumo_deductions) > 0 THEN
    FOR v_deduction IN
      SELECT
        (d->>'insumoId')::TEXT AS insumo_id,
        (d->>'quantity')::INTEGER AS quantity
      FROM jsonb_array_elements(v_order.insumo_deductions) AS d
      ORDER BY (d->>'insumoId')::TEXT ASC
    LOOP
      IF v_deduction.quantity IS NOT NULL AND v_deduction.quantity > 0 THEN
        UPDATE insumos
        SET stock = stock + v_deduction.quantity,
            updated_at = NOW()
        WHERE id = v_deduction.insumo_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE orders
  SET status = p_new_status
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'message', 'Pedido actualizado e insumos restaurados');
END;
$$;

-- E. Ajuste atómico de stock (evita condiciones de carrera en reabastecimiento rápido)
CREATE OR REPLACE FUNCTION adjust_insumo_stock_atomic(p_insumo_id TEXT, p_delta INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated insumos%ROWTYPE;
BEGIN
  UPDATE insumos
  SET stock = GREATEST(0, stock + p_delta),
      updated_at = NOW()
  WHERE id = p_insumo_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insumo no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'insumo', to_jsonb(v_updated));
END;
$$;

-- =============================================
-- DATOS SEED INICIALES (Cambiar PIN de Admin en producción)
-- =============================================
INSERT INTO users (id, username, full_name, role, pin) VALUES
  ('usr_admin_default', 'Admin', 'Administrador', 'admin', crypt('1927', gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

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

-- Sincronizar ambas secuencias con máximos existentes
SELECT setval('order_number_seq', COALESCE((SELECT MAX(order_number) FROM orders), 0) + 1, false);
SELECT setval(
  'invoice_number_seq',
  COALESCE((SELECT MAX(NULLIF(regexp_replace(invoice_number, '[^0-9]', '', 'g'), '')::INTEGER) FROM invoices), 0) + 1,
  false
);

-- =============================================
-- SEGURIDAD DE COLUMNAS Y ROW LEVEL SECURITY (RLS)
-- =============================================
-- Bloquear lectura directa de la columna `pin` (bcrypt) desde clientes PostgREST
REVOKE SELECT ON TABLE public.users FROM anon, authenticated;
GRANT SELECT (id, username, full_name, role, created_at) ON TABLE public.users TO anon, authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Políticas idempotentes
DROP POLICY IF EXISTS "Allow all on users" ON users;
DROP POLICY IF EXISTS "Allow read users without pin" ON users;
DROP POLICY IF EXISTS "Allow update users" ON users;
DROP POLICY IF EXISTS "Allow delete users" ON users;
CREATE POLICY "Allow read users without pin" ON users FOR SELECT USING (true);
CREATE POLICY "Allow update users" ON users FOR UPDATE USING (id <> 'usr_admin_default') WITH CHECK (id <> 'usr_admin_default');
CREATE POLICY "Allow delete users" ON users FOR DELETE USING (id <> 'usr_admin_default');

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'catalog_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE catalog_items;
  END IF;
END $$;
