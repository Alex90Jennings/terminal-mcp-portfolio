terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Same state bucket as infra/bedrock, under its own key. Pass the bucket at init:
  #   terraform init -backend-config="bucket=operafy-tfstate-<account>"
  backend "s3" {
    key          = "portfolio-mcp/cv.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
