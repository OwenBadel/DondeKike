# 🤖 Directiva Agéntica: Donde Kike POS & Comandas Móviles

---
project_id: "PROJ-004-DONDEKIKE-POS"
project_name: "Donde Kike POS"
absolute_disk_path: "d:/Proyectos/LemonFabrica/Fabrica_Software/projects/DondeKike"
okf_project_node: "[[Proyectos/PROJ_004_DondeKike_POS|Donde Kike POS]]"
architecture_node: "[[Decisiones de Arquitectura/ARQ_001_Frontend_Hibrido_Mobile_POS|ARQ-001: Frontend Híbrido Móvil & Web POS]]"
mcp_server_entrypoint: "d:/Proyectos/LemonFabrica/Fabrica_Software/mcp/server.py"
status: "active"
created_at: "2026-09-09T23:30:00-05:00"
updated_at: "2026-09-26T18:25:00-05:00"
tags:
  - agent/pos
  - ionic/angular
  - capacitor/android
  - supabase/realtime
---

## 🎯 1. Identidad y Misión del Enjambre Agéntico
Este proyecto es operado por el **Enjambre de Agentes Especialistas de Lemon Fábrica de Software**.
Directorio local en disco duro:
`d:\Proyectos\LemonFabrica\Fabrica_Software\projects\DondeKike`

---

## 🏛️ 2. Marco Arquitectónico
Este proyecto sigue la arquitectura [[Decisiones de Arquitectura/ARQ_001_Frontend_Hibrido_Mobile_POS|ARQ-001]]:
* **Frontend:** Angular 20 Standalone Components + Ionic 8 UI + SCSS Modular.
* **Móvil:** Capacitor 8 para Android (Cámara, Haptics, Local Notifications, Filesystem).
* **BaaS / Realtime:** Supabase PostgreSQL con canales WebSockets en vivo para cocina y caja.
* **Estilos & UX:** [[Desarrollos Frontend/FE_SCSS_Theming_Tokens|SCSS Theming]] y [[Desarrollos Frontend/FE_Componentes_POS_Checkout|Componentes Checkout]].

---

## 📦 3. Librerías Autorizadas del Ecosistema
* [[Librerías JS/LIB_Angular_20|Angular 20]] (`@angular/core`, `@angular/router`, `@angular/forms`)
* [[Librerías JS/LIB_Ionic_Angular_8|Ionic Framework 8]] (`@ionic/angular`, `ionicons`)
* [[Librerías JS/LIB_Capacitor_8|Capacitor 8]] (`@capacitor/camera`, `@capacitor/haptics`, `@capacitor/filesystem`)
* [[Librerías JS/LIB_Supabase_JS|Supabase Client JS]] (`@supabase/supabase-js`)
* [[Librerías JS/LIB_RxJS|RxJS]] (`rxjs`)
* [[Librerías JS/LIB_Chart_JS|Chart.js]] (`chart.js`)
* [[Librerías JS/LIB_SweetAlert2|SweetAlert2]] (`sweetalert2`)

---

## 🛠️ 4. Habilidades Requeridas (Skills)
* [[Técnicas/SKILL_008_Desarrollo_Hibrido_Mobile_Capacitor|SKILL-008: Desarrollo Híbrido Móvil con Capacitor]]
* [[Técnicas/SKILL_009_Frontend_POS_State_RxJS|SKILL-009: Gestión de Estado Reactivo POS con RxJS]]
* [[Técnicas/SKILL_010_Persistencia_Cloud_Supabase|SKILL-010: Persistencia y Realtime con Supabase]]
* `auto_commit_funcional`: Commits semánticos en español y push al repositorio individual en GitHub.

---

## 🔌 5. Conexión con el Servidor MCP de la Fábrica
El agente tiene acceso directo al Servidor MCP del Grafo OKF:
* **Entrada:** `d:\Proyectos\LemonFabrica\Fabrica_Software\mcp\server.py`
* **Herramientas para Contexto:**
  - Invoca `read_node("ARQ-001-FRONTEND-HIBRIDO-POS")` antes de modificar la estructura de estado.
  - Invoca `search_graph(query="checkout")` para verificar especificaciones de pago.

---

## 📜 6. Reglas de Código en DondeKike
1. **SCSS Estricto:** Utilizar las variables CSS de paleta corporativa (`src/global.scss`).
2. **Sin Memory Leaks:** Desuscribir todo Observable en componentes de Angular usando `takeUntilDestroyed()`.
3. **Ergonomía Táctil:** Botones de acción principal en caja deben respetar el mínimo de 48px y disparar feedback háptico.
4. **Resiliencia ante Fallos:** Si falla una conexión WebSocket, reconectar automáticamente con backoff y persistir offline en IndexedDB.
