/**
 * Payment provider abstraction layer.
 * Swap the concrete implementation (Paystack, Hubtel, Korba, etc.)
 * without changing Cloud Function or Flutter app code.
 */

export interface PaymentInitResult {
  transactionId: string
  status: 'pending' | 'success' | 'failed'
  providerRef?: string
}

export interface PaymentVerifyResult {
  status: 'pending' | 'success' | 'failed'
  amount: number
  network: string
  providerRef?: string
}

export interface PaymentWebhookEvent {
  transactionId: string
  status: 'success' | 'failed'
  amount: number
  network: string
  providerRef?: string
  raw: any
}

export interface PaymentProvider {
  name: string

  /**
   * Initiate a mobile money collection request.
   * Sends a payment prompt to the customer's phone.
   */
  initializePayment(params: {
    amount: number
    phoneNumber: string
    network: 'mtn' | 'telecel' | 'airteltigo'
    reference: string
    description?: string
  }): Promise<PaymentInitResult>

  /**
   * Check payment status (polling fallback).
   */
  verifyPayment(transactionId: string): Promise<PaymentVerifyResult>

  /**
   * Parse and validate a webhook callback from the provider.
   */
  handleWebhook(payload: any, signature?: string): PaymentWebhookEvent
}

/**
 * Stub / sandbox payment provider for development and testing.
 * Simulates a successful MoMo payment after initiation.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  name = 'sandbox'

  async initializePayment(params: {
    amount: number
    phoneNumber: string
    network: 'mtn' | 'telecel' | 'airteltigo'
    reference: string
    description?: string
  }): Promise<PaymentInitResult> {
    const transactionId = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    console.log(`[Sandbox] Payment initiated: ${params.amount} from ${params.phoneNumber} (${params.network}) ref=${params.reference}`)
    return {
      transactionId,
      status: 'pending',
      providerRef: transactionId,
    }
  }

  async verifyPayment(transactionId: string): Promise<PaymentVerifyResult> {
    // Sandbox always returns success after initiation
    console.log(`[Sandbox] Verifying payment: ${transactionId}`)
    return {
      status: 'success',
      amount: 0, // Caller should track the original amount
      network: 'mtn',
      providerRef: transactionId,
    }
  }

  handleWebhook(payload: any, _signature?: string): PaymentWebhookEvent {
    return {
      transactionId: payload.transactionId || '',
      status: payload.status || 'success',
      amount: payload.amount || 0,
      network: payload.network || 'mtn',
      providerRef: payload.providerRef || '',
      raw: payload,
    }
  }
}

/**
 * Get the configured payment provider.
 * In production, replace SandboxPaymentProvider with the real aggregator adapter.
 */
export function getPaymentProvider(): PaymentProvider {
  // TODO: Replace with PaystackProvider, HubtelProvider, etc.
  // const config = functions.config().payment || {}
  // if (config.provider === 'paystack') return new PaystackProvider(config.secret_key)
  return new SandboxPaymentProvider()
}
