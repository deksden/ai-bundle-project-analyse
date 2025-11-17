terraform {
  required_version = ">= 1.5.0"
  required_providers {
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
  }
}

provider "postgresql" {
  host     = var.db_host
  username = var.db_user
  password = var.db_password
  sslmode  = "require"
}

resource "postgresql_database" "research" {
  name              = "research_structure"
  owner             = var.db_user
  connection_limit  = 50
  allow_connections = true
}
