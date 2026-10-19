terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Same state bucket as operafy-infra, under its own key, with a native S3
  # lock file. Pass the bucket at init:
  #   terraform init -backend-config="bucket=operafy-tfstate-<account>"
  backend "s3" {
    key          = "portfolio-mcp/bedrock.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
