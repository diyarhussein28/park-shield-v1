import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { OrdersService } from './orders.service';

export const Address = z.object({
  name: z.string().trim().min(2).max(80),
  line1: z.string().trim().min(3).max(100),
  line2: z.string().trim().max(100).optional(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/),
  city: z.string().trim().min(2).max(60),
  country: z.literal('DE'),
});
const OrderIncluded = z.object({ address: Address });
const OrderReplacement = z.object({ address: Address });

@Controller('v1')
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get('orders')
  async list(@CurrentUser() user: AuthContext) {
    const [orders, includedAvailable, freeReplacements] = await Promise.all([
      this.orders.list(user.userId),
      this.orders.includedAvailable(user.userId),
      this.orders.freeReplacements(user.userId),
    ]);
    return { orders, includedAvailable, freeReplacements };
  }

  @Post('vehicles/:id/order-included')
  order(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) vehicleId: string,
    @Body(new ZodPipe(OrderIncluded)) body: z.infer<typeof OrderIncluded>,
  ) {
    return this.orders.orderIncluded(user.userId, vehicleId, body.address);
  }

  /** US-13: paid replacement (€5.90); returns the checkout URL. */
  @Post('vehicles/:id/order-replacement')
  @HttpCode(200)
  replacement(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) vehicleId: string,
    @Body(new ZodPipe(OrderReplacement)) body: z.infer<typeof OrderReplacement>,
  ) {
    return this.orders.orderReplacement(user.userId, vehicleId, body.address, user.preferredLang);
  }
}
