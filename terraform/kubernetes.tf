resource "kubernetes_namespace" "discord_bot" {
  metadata {
    name = "discord-bot"
  }
}

resource "kubernetes_secret" "discord_bot_secrets" {
  metadata {
    name      = "discord-bot-secrets"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  data = {
    DISCORD_TOKEN   = var.discord_token
    N8N_WEBHOOK_URL = var.n8n_webhook_url
  }

  type = "Opaque"
}

data "aws_ecr_authorization_token" "token" {}

resource "kubernetes_secret" "ecr_registry" {
  metadata {
    name      = "ecr-registry"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  type = "kubernetes.io/dockerconfigjson"

  data = {
    ".dockerconfigjson" = jsonencode({
      auths = {
        "${split("/", aws_ecr_repository.discord_bot.repository_url)[0]}" = {
          auth = data.aws_ecr_authorization_token.token.authorization_token
        }
      }
    })
  }
}

resource "kubernetes_deployment" "discord_bot" {
  metadata {
    name      = "discord-bot"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
    labels = {
      app = "discord-bot"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "discord-bot"
      }
    }

    template {
      metadata {
        labels = {
          app = "discord-bot"
        }
      }

      spec {
        image_pull_secrets {
          name = kubernetes_secret.ecr_registry.metadata[0].name
        }

        container {
          image = "${aws_ecr_repository.discord_bot.repository_url}:latest"
          name  = "discord-bot"

          env {
            name = "DISCORD_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "DISCORD_TOKEN"
              }
            }
          }
          env {
            name = "N8N_WEBHOOK_URL"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "N8N_WEBHOOK_URL"
              }
            }
          }

          resources {
            requests = {
              memory = "128Mi"
              cpu    = "100m"
            }
            limits = {
              memory = "512Mi"
              cpu    = "500m"
            }
          }
        }
      }
    }
  }

  depends_on = [null_resource.packer_build]
}
