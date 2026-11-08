-- =====================================================================
-- 06_create_users.sql: користувачі вебзастосунку і ролі (рівень 3)
--   admin   - повний доступ, керування користувачами, журнал, резервні копії
--   manager - робота з клієнтами, авто, замовленнями, платежами
--   viewer  - лише перегляд, звіти та аналітика
-- Паролі зберігаються як хеш PBKDF2-SHA256 (формат werkzeug.security).
-- Тестові облікові записи: admin / Admin2026!, менеджери / Manager2026!,
-- accountant / Viewer2026!
-- =====================================================================

CREATE TABLE users (
    user_id        SERIAL PRIMARY KEY,
    username       VARCHAR(30)  NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
    password_hash  VARCHAR(255) NOT NULL,
    email          VARCHAR(100) NOT NULL UNIQUE
                   CHECK (email ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
    full_name      VARCHAR(100) NOT NULL,
    role           VARCHAR(10)  NOT NULL DEFAULT 'viewer'
                   CHECK (role IN ('admin', 'manager', 'viewer')),
    manager_id     INTEGER      UNIQUE REFERENCES managers(manager_id) ON DELETE SET NULL,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login     TIMESTAMP
);

INSERT INTO users (username, password_hash, email, full_name, role, manager_id) VALUES
('admin',      'pbkdf2:sha256:600000$TrzRdYaUjc5P4Rde$51e4cc190fc2e6cba3c5bec29db81bbb9465523ded7d5aa9ca509c10312bde09', 'admin@usacars.ua',        'Адміністратор системи', 'admin',   NULL),
('hordiichuk', 'pbkdf2:sha256:600000$VN9oHVZx4FxCEcnC$8d891c965b1980701f8166a4a00a926c5a8e1f0312ae9ba485ae30b30e6da17e', 'v.hordiichuk@usacars.ua', 'Гордійчук Василь',      'manager', 1),
('mazurets',   'pbkdf2:sha256:600000$9O6HCzJ4C2l08KA4$4e32a896b1e3501234b96987d8691ed5a6276d4d65d602e23c48bcd4a122df30', 's.mazurets@usacars.ua',   'Мазурець Світлана',     'manager', 2),
('pavliuk',    'pbkdf2:sha256:600000$EcL0Cms7CcWIAHqh$bd00c9b1074f6bc368ec0af3ddf4a82884c977d8212b5d7d4e05a7b45c475cbc', 'b.pavliuk@usacars.ua',    'Павлюк Богдан',         'manager', 3),
('kyryliuk',   'pbkdf2:sha256:600000$ZDPqVGMwdeWOK9yu$f637d41d98b1f8fa2eea0ab941bbc2686323cbda7b62d9b5069e7ce1350670eb', 'o.kyryliuk@usacars.ua',   'Кирилюк Ольга',         'manager', 4),
('yukhymchuk', 'pbkdf2:sha256:600000$fC8BAw9Wv9fAMbD5$793e37f7d4a948731d345d910a073c8ae7bc611731ea0194d6a435d87974789d', 't.yukhymchuk@usacars.ua', 'Юхимчук Тарас',         'manager', 5),
('dmytruk',    'pbkdf2:sha256:600000$MebF4kj8ApXxAOxC$de0b32fcdfdc206940871fad30c47941c6abb005a64f03c838d4834604b80829', 'm.dmytruk@usacars.ua',    'Дмитрук Марина',        'manager', 6),
('sydoruk',    'pbkdf2:sha256:600000$NCC8JYQCD24VAmUc$f29fa1572b4485349395db436a1e4aea993047d876c2a2071383dca305a783f2', 'i.sydoruk@usacars.ua',    'Сидорук Ігор',          'manager', 7),
('klymchuk',   'pbkdf2:sha256:600000$L0cG83z5s9blJMwR$3acee1aa10c0f585678a6edca88dd04c4807b14f9eadc58f6765146fc787e4bb', 'a.klymchuk@usacars.ua',   'Климчук Анна',          'manager', 8),
('accountant', 'pbkdf2:sha256:600000$LMXjIFvXxIbbpyHn$d16e046e76a479fbde80480df4f0882d25a6652fedb5417cfd2a5d55265326df', 'buh@usacars.ua',          'Бухгалтер (перегляд)',  'viewer',  NULL);
