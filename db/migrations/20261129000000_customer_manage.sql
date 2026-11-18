-- migrate:up
-- Back office: create customer accounts (sends a sign-in link), suspend/reactivate them, change their
-- language or free replacements, and start an account deletion on their behalf. Granted to admin.
INSERT INTO permissions (code, description) VALUES
 ('customer.manage', 'Create, suspend, edit and delete customer accounts');
INSERT INTO staff_role_permissions (role_code, permission_code) VALUES ('admin', 'customer.manage');

-- migrate:down
DELETE FROM staff_role_permissions WHERE permission_code = 'customer.manage';
DELETE FROM permissions WHERE code = 'customer.manage';
