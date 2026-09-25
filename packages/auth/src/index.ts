import { createHash, timingSafeEqual } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'

export type AuthConfig = {
  password: string
  signingSecret: string
  issuer: string
  audience: string
}

export class AuthService {
  private readonly key: Uint8Array
  private readonly expectedPasswordHash: Buffer

  constructor(private readonly config: AuthConfig) {
    this.key = new TextEncoder().encode(config.signingSecret)
    this.expectedPasswordHash = createHash('sha256')
      .update(config.password)
      .digest()
  }

  checkPassword(candidate: string): boolean {
    const candidateHash = createHash('sha256').update(candidate).digest()
    return timingSafeEqual(candidateHash, this.expectedPasswordHash)
  }

  async issueAccess(): Promise<{ accessToken: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
    const accessToken = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(new Date(expiresAt).getTime() / 1000))
      .sign(this.key)

    return { accessToken, expiresAt }
  }

  async issueRefresh(): Promise<string> {
    return new SignJWT({ tokenType: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(this.key)
  }

  async verifyAccess(token: string): Promise<void> {
    await this.verify(token, 'access')
  }

  async verifyRefresh(token: string): Promise<void> {
    await this.verify(token, 'refresh')
  }

  private async verify(
    token: string,
    type: 'access' | 'refresh',
  ): Promise<void> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'iss', 'aud', 'tokenType'],
    })

    if (payload.tokenType !== type) {
      throw new Error('Invalid token type')
    }
  }
}
