import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { TokenService } from './auth/token.service';
import { CryptoService } from './crypto/crypto.service';
import { ManageTokenService } from './crypto/manage-token';
import { PlanLimitsService } from './plan-limits/plan-limits.service';

@Global()
@Module({
  providers: [TokenService, AuditService, PlanLimitsService, CryptoService, ManageTokenService],
  exports: [TokenService, AuditService, PlanLimitsService, CryptoService, ManageTokenService],
})
export class CommonModule {}
