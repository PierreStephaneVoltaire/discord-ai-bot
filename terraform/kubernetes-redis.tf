# Redis Deployment for Hot State Management
# Uses ECR Public Gallery image (non-Bitnami)
# Deployed in the discord-bot namespace for simplicity

resource "kubernetes_config_map" "redis_config" {
  metadata {
    name      = "redis-config"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  data = {
    "redis.conf" = <<-EOT
      # Memory management
      maxmemory 4gb
      maxmemory-policy allkeys-lru

      # Persistence (AOF)
      appendonly yes
      appendfsync everysec

      # RDB snapshots
      save 900 1
      save 300 10
      save 60 10000

      # Logging
      loglevel notice

      # Security
      protected-mode no

      # Performance
      tcp-keepalive 300
      timeout 0
    EOT
  }
}

resource "kubernetes_persistent_volume_claim" "redis_data" {
  metadata {
    name      = "redis-data"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "5Gi"
      }
    }
    # Use do-block-storage or your cluster's default storage class
    storage_class_name = "do-block-storage"
  }
}

resource "kubernetes_stateful_set" "redis" {
  metadata {
    name      = "redis"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
    labels = {
      app = "redis"
    }
  }

  spec {
    service_name = "redis"
    replicas     = 1

    selector {
      match_labels = {
        app = "redis"
      }
    }

    template {
      metadata {
        labels = {
          app = "redis"
        }
      }

      spec {
        container {
          name  = "redis"
          # Using ECR Public Gallery - official Redis image
          image = "public.ecr.aws/docker/library/redis:7-alpine"

          command = ["redis-server", "/etc/redis/redis.conf"]

          port {
            container_port = 6379
            name           = "redis"
          }

          volume_mount {
            name       = "redis-config"
            mount_path = "/etc/redis"
          }

          volume_mount {
            name       = "redis-data"
            mount_path = "/data"
          }

          resources {
            requests = {
              memory = "256Mi"
              cpu    = "100m"
            }
            limits = {
              memory = "4Gi"
              cpu    = "1000m"
            }
          }

          liveness_probe {
            exec {
              command = ["redis-cli", "ping"]
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            exec {
              command = ["redis-cli", "ping"]
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
            failure_threshold     = 2
          }
        }

        volume {
          name = "redis-config"
          config_map {
            name = kubernetes_config_map.redis_config.metadata[0].name
          }
        }

        volume {
          name = "redis-data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.redis_data.metadata[0].name
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "redis" {
  metadata {
    name      = "redis"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
    labels = {
      app = "redis"
    }
  }

  spec {
    type = "ClusterIP"

    selector = {
      app = "redis"
    }

    port {
      port        = 6379
      target_port = 6379
      name        = "redis"
    }
  }
}

# Network policy removed - Redis is now in the same namespace as discord-bot
