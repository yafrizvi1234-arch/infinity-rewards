import {
  Timestamp,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  reportFirestoreListenerError,
} from '../firebase';
import {
  MultiEntitlementRecord,
  PaymentMethod,
  PaymentNumbersConfig,
  PaymentRequestRecord,
  PaymentStatus,
} from '../types';
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

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    try {
      return Number((val as { toMillis: () => number }).toMillis());
    } catch {
      return Date.now();
    }
  }
  return Date.now();
}

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
  const path = `paymentTransactions/${txKey}`;
  try {
    const snap = await getDoc(doc(db, 'paymentTransactions', txKey));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribePaymentNumbersConfig(
  onUpdate: (config: PaymentNumbersConfig) => void,
  onError?: (err: Error) => void
): () => void {
  const docPath = `paymentConfig/${MULTI5_PLAN_ID}`;
  return onSnapshot(
    doc(db, 'paymentConfig', MULTI5_PLAN_ID),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(DEFAULT_PAYMENT_NUMBERS);
        return;
      }
      const data = snap.data();
      onUpdate({
        id: MULTI5_PLAN_ID,
        bkashNumber: String(data.bkashNumber ?? DEFAULT_PAYMENT_NUMBERS.bkashNumber),
        nagadNumber: String(data.nagadNumber ?? DEFAULT_PAYMENT_NUMBERS.nagadNumber),
        updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
        updatedByEmail: data.updatedByEmail ? String(data.updatedByEmail) : undefined,
        updatedAtMs: data.updatedAt ? timestampToMs(data.updatedAt) : undefined,
      });
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.GET, docPath, onError);
    }
  );
}

export async function updatePaymentNumbersConfigSecure(params: {
  bkashNumber: string;
  nagadNumber: string;
}): Promise<PaymentNumbersConfig> {
  const adminSession = await assertVerifiedAdminSession();
  const bkashNumber = validatePersonalPaymentNumber(params.bkashNumber, 'bKash (Personal)');
  const nagadNumber = validatePersonalPaymentNumber(params.nagadNumber, 'Nagad (Personal)');
  const docPath = `paymentConfig/${MULTI5_PLAN_ID}`;

  try {
    await setDoc(doc(db, 'paymentConfig', MULTI5_PLAN_ID), {
      id: MULTI5_PLAN_ID,
      bkashNumber,
      nagadNumber,
      updatedBy: adminSession.uid,
      updatedByEmail: adminSession.email.slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }

  return {
    id: MULTI5_PLAN_ID,
    bkashNumber,
    nagadNumber,
    updatedBy: adminSession.uid,
    updatedByEmail: adminSession.email,
    updatedAtMs: Date.now(),
  };
}

function mapPaymentRequest(id: string, data: Record<string, unknown>): PaymentRequestRecord {
  const status: PaymentStatus =
    data.status === 'approved' || data.status === 'rejected' || data.status === 'pending'
      ? data.status
      : 'pending';
  const paymentMethod: PaymentMethod = data.paymentMethod === 'nagad' ? 'nagad' : 'bkash';

  return {
    id,
    uid: String(data.uid ?? ''),
    userName: String(data.userName ?? 'Member'),
    userUsername: String(data.userUsername ?? '@member'),
    planId: MULTI5_PLAN_ID,
    amountBdt: Number(data.amountBdt ?? MULTI5_PRICE_BDT),
    paymentMethod,
    paymentNumber: String(data.paymentNumber ?? ''),
    senderNumber: data.senderNumber ? String(data.senderNumber) : undefined,
    transactionId: String(data.transactionId ?? ''),
    screenshotUrl: String(data.screenshotUrl ?? ''),
    status,
    adminNote: data.adminNote ? String(data.adminNote) : undefined,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
    reviewedByEmail: data.reviewedByEmail ? String(data.reviewedByEmail) : undefined,
    reviewedAtMs: data.reviewedAt ? timestampToMs(data.reviewedAt) : undefined,
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
  };
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

  const requestRef = doc(collection(db, 'paymentRequests'));
  const uploadResult = await uploadPaymentScreenshot(params.uid, requestRef.id, params.screenshotFile);

  const batch = writeBatch(db);
  batch.set(doc(db, 'paymentTransactions', txKey), {
    requestId: requestRef.id,
    createdAt: serverTimestamp(),
  });

  const payload: Record<string, unknown> = {
    id: requestRef.id,
    uid: params.uid,
    userName: params.userName.trim().slice(0, 50) || 'Member',
    userUsername: params.userUsername.trim().slice(0, 32) || '@member',
    planId: MULTI5_PLAN_ID,
    amountBdt: MULTI5_PRICE_BDT,
    paymentMethod: params.paymentMethod,
    paymentNumber: receiverNumber,
    transactionId: txKey,
    screenshotUrl: uploadResult.screenshotUrl,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (cleanSender) {
    payload.senderNumber = cleanSender;
  }

  batch.set(requestRef, payload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `paymentRequests/${requestRef.id}`);
  }

  return requestRef.id;
}

export async function reviewPaymentRequestSecure(params: {
  request: PaymentRequestRecord;
  decision: 'approved' | 'rejected';
  adminNote?: string;
  verifiedProof?: boolean;
}): Promise<void> {
  const adminSession = await assertVerifiedAdminSession();
  const { request: paymentReq, decision, adminNote, verifiedProof } = params;

  if (paymentReq.status !== 'pending') {
    throw new Error('Only pending payment requests can be reviewed.');
  }

  if (decision === 'approved') {
    if (!verifiedProof) {
      throw new Error(
        'Please verify the Transaction ID and Payment Screenshot before approving Multi (5).'
      );
    }
    if (!paymentReq.transactionId || !paymentReq.screenshotUrl || paymentReq.amountBdt !== MULTI5_PRICE_BDT) {
      throw new Error('Incomplete payment proof: cannot approve without valid 50 BDT proof.');
    }
  }

  const cleanNote = (adminNote ?? '').trim().slice(0, 240);
  const batch = writeBatch(db);

  batch.update(doc(db, 'paymentRequests', paymentReq.id), {
    status: decision,
    adminNote:
      cleanNote ||
      (decision === 'approved'
        ? 'Payment verified — Multi (5) activated for applicant account.'
        : 'Payment proof could not be verified.'),
    reviewedBy: adminSession.uid,
    reviewedByEmail: adminSession.email.slice(0, 120),
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (decision === 'approved') {
    // Strictly activate Multi (5) ONLY for the applicant's own UID
    batch.set(doc(db, 'multiEntitlements', paymentReq.uid), {
      uid: paymentReq.uid,
      planId: MULTI5_PLAN_ID,
      active: true,
      maxConcurrentLinks: MULTI5_CONCURRENT_LINKS,
      amountBdt: MULTI5_PRICE_BDT,
      sourceRequestId: paymentReq.id,
      transactionId: paymentReq.transactionId,
      approvedBy: adminSession.uid,
      approvedByEmail: adminSession.email.slice(0, 120),
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `paymentRequests/${paymentReq.id}`);
  }
}

export function subscribeMyPaymentRequests(
  uid: string,
  onUpdate: (requests: PaymentRequestRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'paymentRequests'), where('uid', '==', uid), limit(25));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => mapPaymentRequest(d.id, d.data()))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'paymentRequests', onError);
    }
  );
}

export function subscribeMyMultiEntitlement(
  uid: string,
  onUpdate: (entitlement: MultiEntitlementRecord | null) => void,
  onError?: (err: Error) => void
): () => void {
  const docPath = `multiEntitlements/${uid}`;
  return onSnapshot(
    doc(db, 'multiEntitlements', uid),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const data = snap.data();
      onUpdate({
        uid: String(data.uid ?? uid),
        planId: MULTI5_PLAN_ID,
        active: Boolean(data.active),
        maxConcurrentLinks: Number(data.maxConcurrentLinks ?? MULTI5_CONCURRENT_LINKS),
        amountBdt: Number(data.amountBdt ?? MULTI5_PRICE_BDT),
        sourceRequestId: String(data.sourceRequestId ?? ''),
        transactionId: String(data.transactionId ?? ''),
        approvedBy: String(data.approvedBy ?? ''),
        approvedByEmail: String(data.approvedByEmail ?? ''),
        activatedAtMs: timestampToMs(data.activatedAt),
        updatedAtMs: timestampToMs(data.updatedAt),
      });
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.GET, docPath, onError);
    }
  );
}

export function subscribeAdminPaymentRequests(
  onUpdate: (requests: PaymentRequestRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'paymentRequests'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => mapPaymentRequest(d.id, d.data()))
        .sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          return b.createdAtMs - a.createdAtMs;
        });
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'paymentRequests', onError);
    }
  );
}
