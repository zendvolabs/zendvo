# Environment Variables

This document lists all the environment variables required for the Zendvo backend.

## AWS S3 Configuration (Image Upload)

The following environment variables are required for the image upload feature:

- `AWS_ACCESS_KEY_ID` - AWS access key ID for S3 access
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key for S3 access
- `AWS_REGION` - AWS region where the S3 bucket is located (default: us-east-1)
- `AWS_S3_BUCKET_NAME` - Name of the S3 bucket for storing uploaded images

### Example

```bash
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=zendvo-uploads
```

### S3 Bucket Setup

1. Create an S3 bucket in your AWS account
2. Configure the bucket with a public bucket policy granting `s3:GetObject` access for `uploads/*`, matching the direct S3 URLs returned by the storage implementation.
3. Set up CORS if needed for your frontend domain
4. Ensure the IAM user/role has the following permissions:
   - `s3:PutObject`
5. For IAM role/instance profile deployments, omit AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to use default credential chain

### Security Notes

- Never commit actual AWS credentials to version control
- Use IAM roles with least privilege in production
- Consider using AWS S3 bucket policies instead of ACLs for better security
- Enable server-side encryption for uploaded files

## Savings Trustline (Sponsored ChangeTrust)

`POST /api/savings/trustline` returns a sponsored transaction envelope that opens the
trustline a user account needs before it can interact with a savings vault. The platform
sponsor signs the envelope; the user still has to co-sign it before submission.

- `STELLAR_SPONSOR_SECRET` - Secret seed of the platform sponsor account that sponsors the trustline (pays the base reserve and the transaction fee)
- `STELLAR_USDC_ISSUER` - Issuer (`G...`) of the classic asset the savings vaults hold, used by default
- `SAVINGS_TRUSTLINE_ASSET_CODE` - Optional asset code override for the default savings trustline (default: `USDC`)
- `SAVINGS_TRUSTLINE_ASSET_ISSUER` - Optional issuer override for the default savings trustline (falls back to `STELLAR_USDC_ISSUER`)
- `SAVINGS_VAULT_TRUSTLINE_ASSETS` - Optional JSON map of per-vault trustline assets, keyed by vault contract id (`C...`)

### Example

```bash
STELLAR_SPONSOR_SECRET=SXXXX...
STELLAR_USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
SAVINGS_VAULT_TRUSTLINE_ASSETS='{"CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR":{"code":"USDC","issuer":"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"}}'
```

### Notes

- A vault that is not listed in `SAVINGS_VAULT_TRUSTLINE_ASSETS` falls back to the default savings asset.
- `SAVINGS_VAULT_TRUSTLINE_ASSETS` must be valid JSON; the endpoint fails with a configuration error otherwise.
- The sponsor account sequence number is re-read from Horizon for every request so consecutive envelopes stay submittable.

## Bank Account Encryption (Wallet Off-Ramp)

`POST /api/wallet/banks` encrypts account numbers at rest with AES-256-GCM and
deduplicates them with a keyed HMAC-SHA256 fingerprint. There are no default keys:
if a variable below is missing or malformed the endpoint returns a 500 and stores nothing.

- `BANK_ACCOUNT_ENCRYPTION_KEY` - 32-byte AES-256 key, hex (64 chars) or base64
- `BANK_ACCOUNT_ENCRYPTION_KEY_VERSION` - Optional positive integer stored with each row to support key rotation (default: `1`)
- `BANK_ACCOUNT_FINGERPRINT_KEY` - Secret of at least 32 bytes (hex or base64) for the HMAC fingerprint; keep it different from the encryption key

### Example

```bash
# Generate each key separately: openssl rand -hex 32
BANK_ACCOUNT_ENCRYPTION_KEY=<64 hex chars>
BANK_ACCOUNT_ENCRYPTION_KEY_VERSION=1
BANK_ACCOUNT_FINGERPRINT_KEY=<64 hex chars>
```

### Notes

- Changing `BANK_ACCOUNT_FINGERPRINT_KEY` invalidates duplicate detection for existing rows; treat it as a re-index, not a routine rotation.
- Never log or commit these values.
