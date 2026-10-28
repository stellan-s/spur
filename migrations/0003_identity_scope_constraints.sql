ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_access_request_fk
  FOREIGN KEY (organization_id, user_id)
  REFERENCES access_requests(organization_id, user_id) ON DELETE CASCADE;

ALTER TABLE user_permission_grants
  ADD CONSTRAINT user_permission_grants_access_request_fk
  FOREIGN KEY (organization_id, user_id)
  REFERENCES access_requests(organization_id, user_id) ON DELETE CASCADE;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_access_request_fk
  FOREIGN KEY (organization_id, user_id)
  REFERENCES access_requests(organization_id, user_id) ON DELETE CASCADE;
