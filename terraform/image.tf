resource "aws_ecr_repository" "discord_bot" {
  name                 = "discord-bot"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "discord_bot" {
  repository = aws_ecr_repository.discord_bot.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

locals {
  # Calculate hash of the app directory to trigger builds on change
  app_src_files = fileset("${path.module}/../app/src", "**")
  app_src_hash  = sha1(join("", [for f in local.app_src_files : filesha1("${path.module}/../app/src/${f}")]))

  app_template_files = fileset("${path.module}/../app/templates", "**")
  app_template_hash  = sha1(join("", [for f in local.app_template_files : filesha1("${path.module}/../app/templates/${f}")]))

  package_hash  = filesha1("${path.module}/../app/package.json")
  tsconfig_hash = filesha1("${path.module}/../app/tsconfig.json")

  # Also check docker files
  docker_hash   = filesha1("${path.module}/../docker/build.pkr.hcl")
  build_trigger = substr(sha1("${local.app_src_hash}-${local.app_template_hash}-${local.package_hash}-${local.tsconfig_hash}-${local.docker_hash}"), 0, 16)
}

resource "null_resource" "packer_build" {
  triggers = {
    dir_sha1 = local.build_trigger
    repo_url = aws_ecr_repository.discord_bot.repository_url
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../docker"
    command     = <<EOT
      aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      packer init build.pkr.hcl
      packer build -var "image_repository=${aws_ecr_repository.discord_bot.repository_url}" -var "image_tag=${local.build_trigger}" build.pkr.hcl
    EOT
  }

  depends_on = [aws_ecr_repository.discord_bot]
}

resource "aws_ecr_repository" "dev_sandbox" {
  name                 = "dev-sandbox"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "dev_sandbox" {
  repository = aws_ecr_repository.dev_sandbox.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
locals {
  # Dev sandbox build trigger
  dev_sandbox_packer_hash   = filesha1("${path.module}/../docker/dev-sandbox.pkr.hcl")
  dev_sandbox_build_trigger = substr(sha1(local.dev_sandbox_packer_hash), 0, 16)
}

resource "null_resource" "dev_sandbox_build" {
  triggers = {
    dir_sha1 = local.dev_sandbox_build_trigger
    repo_url = aws_ecr_repository.dev_sandbox.repository_url
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../docker"
    command     = <<EOT
 aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      packer init dev-sandbox.pkr.hcl
      packer build -var "image_repository=${aws_ecr_repository.dev_sandbox.repository_url}" -var "image_tag=${local.dev_sandbox_build_trigger}" dev-sandbox.pkr.hcl
    EOT
  }

  depends_on = [aws_ecr_repository.dev_sandbox]
}
