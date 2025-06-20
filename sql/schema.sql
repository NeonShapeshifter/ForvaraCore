-- Forvara Core Hub - Database Schema
-- Sistema multitenant para gestión de usuarios, empresas y suscripciones

-- =============================================================================
-- EXTENSIONES
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLAS PRINCIPALES
-- =============================================================================

-- Usuarios individuales (sincronizado con auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    avatar_url TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Empresas/Tenants registrados
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(255) NOT NULL,
    ruc VARCHAR(20) UNIQUE NOT NULL,
    direccion TEXT,
    telefono VARCHAR(20),
    email VARCHAR(255),
    logo_url TEXT,
    configuracion JSONB DEFAULT '{}',
    activo BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relación usuarios-empresas (M:N)
CREATE TABLE user_tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rol VARCHAR(50) NOT NULL DEFAULT 'miembro', -- admin, miembro, viewer
    activo BOOLEAN DEFAULT true,
    permisos JSONB DEFAULT '[]', -- permisos específicos por usuario
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(usuario_id, tenant_id)
);

-- Suscripciones por app
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    app_id VARCHAR(50) NOT NULL, -- 'elaris', 'forvara-mail', etc.
    plan VARCHAR(50) NOT NULL DEFAULT 'free', -- free, trial, pro, enterprise
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, expired, cancelled, suspended
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    auto_renew BOOLEAN DEFAULT false,
    stripe_subscription_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, app_id)
);

-- Características y límites por tenant
CREATE TABLE tenant_features (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    app_id VARCHAR(50) NOT NULL,
    max_users INTEGER DEFAULT 3,
    max_storage_gb INTEGER DEFAULT 1,
    enabled_modules TEXT[] DEFAULT ARRAY['core'],
    rate_limits JSONB DEFAULT '{"requests_per_minute": 100}',
    custom_limits JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, app_id)
);

-- Log de actividad para auditoría
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),
    usuario_id UUID REFERENCES users(id),
    app_id VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ÍNDICES PARA PERFORMANCE
-- =============================================================================

CREATE INDEX idx_users_telefono ON users(telefono);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_tenants_ruc ON tenants(ruc);
CREATE INDEX idx_user_tenants_usuario ON user_tenants(usuario_id);
CREATE INDEX idx_user_tenants_tenant ON user_tenants(tenant_id);
CREATE INDEX idx_subscriptions_tenant_app ON subscriptions(tenant_id, app_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_expires ON subscriptions(expires_at);
CREATE INDEX idx_tenant_features_tenant_app ON tenant_features(tenant_id, app_id);
CREATE INDEX idx_activity_logs_tenant ON activity_logs(tenant_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at);

-- =============================================================================
-- FUNCIONES AUXILIARES
-- =============================================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Triggers para updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_tenants_updated_at BEFORE UPDATE ON user_tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Crear usuario desde auth
CREATE OR REPLACE FUNCTION crear_usuario_desde_auth()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, nombre, apellido, telefono, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'nombre', 'Usuario'),
        COALESCE(NEW.raw_user_meta_data->>'apellido', ''),
        COALESCE(NEW.raw_user_meta_data->>'telefono', NEW.phone, ''),
        NEW.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION crear_usuario_desde_auth();

-- Trigger: Configurar tenant inicial
CREATE OR REPLACE FUNCTION handle_new_tenant()
RETURNS TRIGGER AS $$
BEGIN
    -- Crear suscripción trial por defecto
    INSERT INTO subscriptions (tenant_id, app_id, plan, status, expires_at)
    VALUES (
        NEW.id,
        'elaris',
        'trial',
        'active',
        NOW() + INTERVAL '15 days'
    );
    
    -- Configurar límites básicos
    INSERT INTO tenant_features (tenant_id, app_id, max_users, enabled_modules)
    VALUES (
        NEW.id,
        'elaris',
        3,
        ARRAY['inventario', 'ventas', 'compras']
    );
    
    -- Añadir al creador como admin
    INSERT INTO user_tenants (usuario_id, tenant_id, rol)
    VALUES (NEW.created_by, NEW.id, 'admin');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_tenant_created
    AFTER INSERT ON tenants
    FOR EACH ROW EXECUTE FUNCTION handle_new_tenant();

-- =============================================================================
-- FUNCIONES RPC ÚTILES
-- =============================================================================

-- Obtener usuario actual con sus tenants y permisos
CREATE OR REPLACE FUNCTION get_usuario_actual()
RETURNS JSON AS $$
DECLARE
    current_user_id UUID;
    result JSON;
BEGIN
    current_user_id := auth.uid();
    
    IF current_user_id IS NULL THEN
        RETURN '{"error": "No autenticado"}'::JSON;
    END IF;
    
    SELECT json_build_object(
        'usuario', json_build_object(
            'id', u.id,
            'nombre', u.nombre,
            'apellido', u.apellido,
            'telefono', u.telefono,
            'email', u.email
        ),
        'tenants', json_agg(
            json_build_object(
                'id', t.id,
                'nombre', t.nombre,
                'ruc', t.ruc,
                'rol', ut.rol,
                'activo', ut.activo
            )
        )
    ) INTO result
    FROM users u
    LEFT JOIN user_tenants ut ON u.id = ut.usuario_id AND ut.activo = true
    LEFT JOIN tenants t ON ut.tenant_id = t.id AND t.activo = true
    WHERE u.id = current_user_id
    GROUP BY u.id, u.nombre, u.apellido, u.telefono, u.email;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verificar suscripción activa
CREATE OR REPLACE FUNCTION check_subscription_status(
    p_tenant_id UUID,
    p_app_id TEXT DEFAULT 'elaris'
)
RETURNS JSON AS $$
DECLARE
    subscription_info RECORD;
    features_info RECORD;
    result JSON;
BEGIN
    -- Obtener suscripción
    SELECT * INTO subscription_info
    FROM subscriptions
    WHERE tenant_id = p_tenant_id 
    AND app_id = p_app_id;
    
    -- Obtener características
    SELECT * INTO features_info
    FROM tenant_features
    WHERE tenant_id = p_tenant_id 
    AND app_id = p_app_id;
    
    IF subscription_info IS NULL THEN
        RETURN json_build_object(
            'active', false,
            'error', 'No subscription found'
        );
    END IF;
    
    -- Verificar si está activo
    SELECT json_build_object(
        'active', (
            subscription_info.status = 'active' AND 
            (subscription_info.expires_at IS NULL OR subscription_info.expires_at > NOW())
        ),
        'plan', subscription_info.plan,
        'status', subscription_info.status,
        'expires_at', subscription_info.expires_at,
        'features', json_build_object(
            'max_users', COALESCE(features_info.max_users, 3),
            'max_storage_gb', COALESCE(features_info.max_storage_gb, 1),
            'enabled_modules', COALESCE(features_info.enabled_modules, ARRAY['core']),
            'rate_limits', COALESCE(features_info.rate_limits, '{"requests_per_minute": 100}'::jsonb)
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Políticas para users
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (auth.uid() = id);

-- Políticas para tenants
CREATE POLICY "Users can view their tenants" ON tenants
    FOR SELECT USING (
        id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND activo = true
        )
    );

CREATE POLICY "Admins can update their tenants" ON tenants
    FOR UPDATE USING (
        id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND rol = 'admin' AND activo = true
        )
    );

CREATE POLICY "Users can create tenants" ON tenants
    FOR INSERT WITH CHECK (created_by = auth.uid());

-- Políticas para user_tenants
CREATE POLICY "Users can view their tenant relationships" ON user_tenants
    FOR SELECT USING (
        usuario_id = auth.uid() OR 
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND rol IN ('admin') AND activo = true
        )
    );

-- Políticas para subscriptions
CREATE POLICY "Users can view their tenant subscriptions" ON subscriptions
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND activo = true
        )
    );

CREATE POLICY "Admins can manage subscriptions" ON subscriptions
    FOR ALL USING (
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND rol = 'admin' AND activo = true
        )
    );

-- Políticas para tenant_features
CREATE POLICY "Users can view their tenant features" ON tenant_features
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND activo = true
        )
    );

-- Políticas para activity_logs
CREATE POLICY "Users can view their tenant logs" ON activity_logs
    FOR SELECT USING (
        tenant_id IN (
            SELECT tenant_id FROM user_tenants 
            WHERE usuario_id = auth.uid() AND activo IN ('admin', 'miembro') AND activo = true
        )
    );

-- =============================================================================
-- DATOS INICIALES / SEEDS
-- =============================================================================

-- Insertar planes de ejemplo (esto se puede hacer via migration o API)
-- Los datos reales se insertarán cuando se registren usuarios y empresas

-- =============================================================================
-- COMENTARIOS PARA DOCUMENTACIÓN
-- =============================================================================

COMMENT ON TABLE users IS 'Usuarios individuales sincronizados con Supabase Auth';
COMMENT ON TABLE tenants IS 'Empresas/organizaciones registradas en el sistema';
COMMENT ON TABLE user_tenants IS 'Relación M:N entre usuarios y empresas con roles';
COMMENT ON TABLE subscriptions IS 'Suscripciones activas por tenant y aplicación';
COMMENT ON TABLE tenant_features IS 'Límites y características específicas por tenant';
COMMENT ON TABLE activity_logs IS 'Log de actividad para auditoría y seguridad';

COMMENT ON FUNCTION get_usuario_actual() IS 'Retorna datos del usuario actual con sus tenants y permisos';
COMMENT ON FUNCTION check_subscription_status(UUID, TEXT) IS 'Verifica el estado de suscripción de un tenant para una app específica';
