import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type JwtPayload,
  type PremiumPlan,
  type SubscribeDto,
  subscribeSchema,
  type Subscription,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { PremiumService } from './premium.service';

/**
 * REST surface for premium under `/premium`.
 *
 * `GET /premium/plans` is public (pricing page). `POST /premium/subscribe`
 * validates the chosen plan and returns the caller's current subscription —
 * actual entitlement is granted by the payments webhook calling
 * {@link PremiumService.activate} after a successful charge (this endpoint never
 * grants premium for free). `POST /premium/cancel` flags the subscription to
 * lapse at period end.
 */
@ApiTags('premium')
@Controller('premium')
export class PremiumController {
  constructor(private readonly premiumService: PremiumService) {}

  @Get('plans')
  @ApiOperation({ summary: 'List premium plans (cheapest first)' })
  @ApiOkResponse({ description: 'Premium plan catalogue' })
  async plans(): Promise<PremiumPlan[]> {
    return this.premiumService.findAllPlans();
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Read the caller's subscription state (no side effects)",
    description:
      'Pure read of the current subscription — unlike POST /premium/subscribe, ' +
      'this neither validates a plan nor materialises a record. Returns a ' +
      "synthetic `none` subscription when the caller has never subscribed.",
  })
  @ApiOkResponse({ description: "The caller's subscription record" })
  async subscription(@CurrentUser() user: JwtPayload): Promise<Subscription> {
    const sub = await this.premiumService.getSubscriptionState(user.sub);
    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }
    return sub;
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register subscription intent for a plan',
    description:
      'Validates the plan and returns the current subscription. Entitlement is ' +
      'activated by the payments webhook after a successful charge; use the ' +
      'payments checkout endpoint to obtain widget params and pay.',
  })
  @ApiOkResponse({ description: "The caller's subscription record" })
  async subscribe(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(subscribeSchema)) dto: SubscribeDto,
  ): Promise<Subscription> {
    const plan = await this.premiumService.findPlanByCode(dto.plan);
    if (!plan) {
      throw new NotFoundException('Premium plan not found');
    }
    return this.premiumService.getSubscription(user.sub);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the subscription (lapses at period end)',
    description:
      'Marks the subscription canceled and flags it to not renew. Access is ' +
      'retained until the current period ends.',
  })
  @ApiOkResponse({ description: "The caller's updated subscription record" })
  async cancel(@CurrentUser() user: JwtPayload): Promise<Subscription> {
    // User-initiated: actually stop billing at CloudPayments, then flip state.
    await this.premiumService.cancelAtPeriodEnd(user.sub);
    return this.premiumService.getSubscription(user.sub);
  }
}
