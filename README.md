# multi-tenancy-saas-demo

Demo of building a multi-tenancy saas app w/ Turso.

- app-admin: client code for an internal-only admin app. Something every SaaS tool needs. It shows information about each app instance and lets you create new ones or clone existing ones (useful for setting up demos). It communicates with Turso to manage db instances and reads/writes to an admin database.
- server: API for the admin app
- app-todos: the app-server. It uses an embedded replica to pull down the admin database so it can correctly serve each app instance
