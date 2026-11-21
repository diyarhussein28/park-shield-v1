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
import { AppReturn } from '../billing/app-return';

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
const OrderPrint = z.object({ address: Address, appReturn: AppReturn });

@Controller('v1')
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get('orders')
  async list(@CurrentUser() user: AuthContext) {
    const [orders, includedAvailable, freeReplacements, printPriceCents] = await Promise.all([
      this.orders.list(user.userId),
      this.orders.includedAvailable(user.userId),
      this.orders.freeReplacements(user.userId),
      this.orders.printPrice(),
    ]);
    return { orders, includedAvailable, freeReplacements, printPriceCents };
  }

  /** The print options screen: both prices before the owner confirms. */
  @Get('vehicles/:id/print-options')
  printOptions(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) _id: string) {
    return this.orders.printOptions(user.userId);
  }

  /**
   * „Drucken und zusenden lassen“: free once (welcome print), then 3 € (Stripe one-time payment).
   * `order-included` and `order-replacement` are the old names of the same action.
   */
  @Post(['vehicles/:id/order-print', 'vehicles/:id/order-included', 'vehicles/:id/order-replacement'])
  @HttpCode(200)
  print(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) vehicleId: string,
    @Body(new ZodPipe(OrderPrint)) body: z.infer<typeof OrderPrint>,
  ) {
    return this.orders.orderPrint(
      user.userId,
      vehicleId,
      body.address,
      user.preferredLang,
      body.appReturn,
    );
  }
}
