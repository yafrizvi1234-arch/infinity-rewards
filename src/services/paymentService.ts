import { auth } from '../firebase';
import {
  LinkReportRecord,
  ManagedLink,
  ModerationLogRecord,
  MultiEntitlementRecord,
  PaymentMethod,
  PaymentNumbersConfig,
  PaymentRequestRecord,
} from '../types';
import {
  apiRequest,
  createPollingSubscription,
  emitSyncTopics,
} from './apiClient';
import { assertVerifiedAdminSession } from './linkService';
import { uploadPaymentScreenshot } from './storageService';

export const MULTI5_PLAN_ID = 'multi_5' as const;
export const MULTI5_PRICE_BDT = 50;
export const MULTI5_CONCURRENT_LINKS = 5;

const envVars = (import.meta as { env?: Record<string, string | undefined> }).env;

export const DEFAULT_PAYMENT_NUMBERS: PaymentNumbersConfig = {
  id: MULTI5_PLAN_ID,
  bkashNumber: envVars?.VITE_BKASH_PERSONAL_NUMBER?.trim() || '01700-000000',
  nagadNumber: envVars?.VITE_NAGAD_PERSONAL_NUMBER?.trim() || '01800-000000',
};

export interface PaymentChannelConfig {
  id: PaymentMethod;
  label: string;
  accountType: 'Personal';
  number: string;
  instructions: string[];
}

export const PAYMENT_CHANNELS: Record<PaymentMethod, PaymentChannelConfig> = {
  bkash: {
    id: 'bkash',
    label: 'bKash (Personal)',
    accountType: 'Personal',
    number: envVars?.VITE_BKASH_PERSONAL_NUMBER?.trim() || '01700-000000',
    instructions: [
      'bKash অ্যাপ থেকে "Send Money" অপশন নির্বাচন করুন (Cash In বা Mobile Recharge করবেন না)।',
      'নিচের Personal নম্বরে ঠিক ৫০ টাকা (50 BDT) Send Money করুন।',
      'পেমেন্ট সম্পন্ন হলে ট্রানজেকশন মেসেজ থেকে সঠিক Transaction ID (TrxID) কপি করুন।',
      'পেমেন্টের স্পষ্ট Screenshot এবং Transaction ID নিচে জমা দিন।',
    ],
  },
  nagad: {
    id: 'nagad',
    label: 'Nagad (Personal)',
    accountType: 'Personal',
    number: envVars?.VITE_NAGAD_PERSONAL_NUMBER?.trim() || '01800-000000',
    instructions: [
      'Nagad অ্যাপ থেকে "Send Money" অপশন নির্বাচন করুন (Cash In বা Recharge করবেন না)।',
      'নিচের Personal নম্বরে ঠিক ৫০ টাকা (50 BDT) Send Money করুন।',
      'পেমেন্ট সফল হওয়ার পর পাওয়া সঠিক Transaction ID (TxnID) কপি করুন।',
      'পেমেন্টের স্পষ্ট Screenshot এবং Transaction ID নিচে জমা দিন।',
    ],
  },
};

export function normalizeAndValidateTransactionId(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (normalized.length < 6 || normalized.length > 40) {
    throw new Error('Transaction ID must be between 6 and 40 characters.');
  }
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw new Error(
      'Transaction ID can only contain letters, numbers, hyphens (-), and underscores (_).'
    );
  }
  return normalized;
}

export function validatePersonalPaymentNumber(raw: string, channelLabel: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 6 || cleaned.length > 24 || !/^[0-9+\-\s]{6,24}$/.test(cleaned)) {
    throw new Error(
      `${channelLabel} number must be 6 to 24 characters using only digits, spaces, + or -.`
    );
  }
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 11) {
    throw new Error(`${channelLabel} number must contain at least 11 digits (e.g. 01XXXXXXXXX).`);
  }
  return cleaned;
}

export async function isTransactionIdAlreadyUsed(txKey: string): Promise<boolean> {
  const res = await apiRequest<{ used: boolean }>(
    `/api/payments/tx-check?txKey=${encodeURIComponent(txKey)}`,
    { method: 'GET' }
  );
  return Boolean(res.used);
}

export function subscribePaymentNumbersConfig(
  onUpdate: (config: PaymentNumbersConfig) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<PaymentNumbersConfig>(
    'payments-config',
    async () => {
      const res = await apiRequest<{ config: PaymentNumbersConfig }>('/api/payments/config');
      return res.config || DEFAULT_PAYMENT_NUMBERS;
    },
    onUpdate,
    onError,
    30000
  );
}

export async function updatePaymentNumbersConfigSecure(params: {
  bkashNumber: string;
  nagadNumber: string;
}): Promise<PaymentNumbersConfig> {
  await assertVerifiedAdminSession();
  const bkashNumber = validatePersonalPaymentNumber(params.bkashNumber, 'bKash (Personal)');
  const nagadNumber = validatePersonalPaymentNumber(params.nagadNumber, 'Nagad (Personal)');

  const res = await apiRequest<{ config: PaymentNumbersConfig }>('/api/admin/payments/config', {
    method: 'PUT',
    body: {
      bkashNumber,
      nagadNumber,
    },
  });

  emitSyncTopics('payments-config');
  return res.config;
}

export async function submitMulti5PaymentRequest(params: {
  uid: string;
  userName: string;
  userUsername: string;
  paymentMethod: PaymentMethod;
  paymentNumber?: string;
  senderNumber?: string;
  transactionId: string;
  screenshotFile: File;
}): Promise<string> {
  const current = auth.currentUser;
  if (!current || current.uid !== params.uid || !current.emailVerified) {
    throw new Error('Verified user session is required to submit a payment request.');
  }

  const txKey = normalizeAndValidateTransactionId(params.transactionId);
  const cleanSender = (params.senderNumber ?? '').trim().slice(0, 24);
  if (cleanSender && !/^[0-9+\-\s]{6,24}$/.test(cleanSender)) {
    throw new Error('Please enter a valid sender mobile number (or leave it blank).');
  }

  const channel = PAYMENT_CHANNELS[params.paymentMethod];
  const receiverNumber = (params.paymentNumber?.trim() || channel.number).slice(0, 24);
  if (!/^[0-9+\-\s]{6,24}$/.test(receiverNumber)) {
    throw new Error('Active payment receiver number is invalid. Please contact admin.');
  }

  const alreadyUsed = await isTransactionIdAlreadyUsed(txKey);
  if (alreadyUsed) {
    throw new Error(
      'This Transaction ID has already been submitted. Duplicate Transaction IDs are not permitted.'
    );
  }

  const tempReqId = `req_${Date.now()}`;
  const uploadResult = await uploadPaymentScreenshot(params.uid, tempReqId, params.screenshotFile);

  const res = await apiRequest<{ id: string }>('/api/payments/request', {
    method: 'POST',
    body: {
      userName: params.userName,
      userUsername: params.userUsername,
      paymentMethod: params.paymentMethod,
      paymentNumber: receiverNumber,
      senderNumber: cleanSender,
      transactionId: txKey,
      screenshotUrl: uploadResult.screenshotUrl,
    },
  });

  emitSyncTopics('payments-me', 'admin-overview');
  return res.id;
}

export async function reviewPaymentRequestSecure(params: {
  request: PaymentRequestRecord;
  decision: 'approved' | 'rejected';
  adminNote?: string;
  verifiedProof?: boolean;
}): Promise<void> {
  await assertVerifiedAdminSession();
  await apiRequest(`/api/admin/payments/${encodeURIComponent(params.request.id)}/review`, {
    method: 'POST',
    body: {
      decision: params.decision,
      adminNote: params.adminNote,
      verifiedProof: Boolean(params.verifiedProof),
    },
  });

  emitSyncTopics('payments-me', 'admin-overview');
}

export async function revokeMulti5PaymentAccessSecure(params: {
  request: PaymentRequestRecord;
  adminNote?: string;
}): Promise<void> {
  await assertVerifiedAdminSession();
  await apiRequest(`/api/admin/payments/${encodeURIComponent(params.request.id)}/revoke`, {
    method: 'POST',
    body: {
      adminNote: params.adminNote,
    },
  });

  emitSyncTopics('payments-me', 'admin-overview');
}

export function subscribeMyPaymentRequests(
  _uid: string,
  onUpdate: (requests: PaymentRequestRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<PaymentRequestRecord[]>(
    'payments-me',
    async () => {
      const res = await apiRequest<{
        requests: PaymentRequestRecord[];
        entitlement: MultiEntitlementRecord | null;
      }>('/api/payments/me');
      return res.requests || [];
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeMyMultiEntitlement(
  _uid: string,
  onUpdate: (entitlement: MultiEntitlementRecord | null) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<MultiEntitlementRecord | null>(
    'payments-me',
    async () => {
      const res = await apiRequest<{
        requests: PaymentRequestRecord[];
        entitlement: MultiEntitlementRecord | null;
      }>('/api/payments/me');
      return res.entitlement ?? null;
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeAdminPaymentRequests(
  onUpdate: (requests: PaymentRequestRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<PaymentRequestRecord[]>(
    'admin-overview',
    async () => {
      const res = await apiRequest<{
        links: ManagedLink[];
        reports: LinkReportRecord[];
        logs: ModerationLogRecord[];
        paymentRequests: PaymentRequestRecord[];
      }>('/api/admin/overview');
      return res.paymentRequests || [];
    },
    onUpdate,
    onError,
    20000
  );
}
