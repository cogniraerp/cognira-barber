import { Module } from '@nestjs/common';
import { ShopContextController } from './shop-context.controller';

@Module({ controllers: [ShopContextController] })
export class ShopContextModule {}
