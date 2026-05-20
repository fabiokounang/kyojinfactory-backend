USE kyojinfactory;

-- Password: admin123 (bcrypt hash, cost 10)
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES (
  'admin@kyojin.local',
  '$2a$10$42ELcE2JavVCuunFrQcJxeuhzhWxoSmJ.oQDoCMAN1XTu072qPapW',
  'Administrator',
  'superadmin',
  1
)
ON DUPLICATE KEY UPDATE email = email;
