import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BarbershopsModule } from '../barbershops/barbershops.module';
import { MeController } from './me.controller';
import { PublicSlugController } from './public-slug.controller';
import { SignupService } from './signup.service';

@Module({
  imports: [BarbershopsModule, AuthModule],
  controllers: [MeController, PublicSlugController],
  providers: [SignupService],
})
export class MeModule {}
