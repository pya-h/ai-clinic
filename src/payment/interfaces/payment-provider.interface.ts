import { PaymentStatusEnum } from '@prisma/client';

export interface PaymentIntent {
  id: string;
  clientSecret?: string;
}

export interface PaymentConfirmation {
  status: PaymentStatusEnum;
}

export interface RefundResult {
  status: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface IPaymentProvider {
  createPaymentIntent(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
  ): Promise<PaymentIntent>;

  confirmPayment(paymentId: string): Promise<PaymentConfirmation>;

  refundPayment(paymentId: string, amount?: number): Promise<RefundResult>;

  getPaymentStatus(paymentId: string): Promise<PaymentStatusEnum>;
}
