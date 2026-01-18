terraform {
  backend "s3" {
    bucket       = "pierre-tf-state"
    key          = "discord-bot/terraform.tfstate"
    region       = "ca-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
