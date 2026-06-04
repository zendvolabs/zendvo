import { z } from "zod";
import { supportedCurrencyCodes } from "@/lib/currency";

type ValidationResult = { valid: true } | { valid: false; error: string; detail: string };

export const validateEmail = (email: string): boolean => {
  const emailRegex =
    /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): boolean => {
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

export const sanitizeInput = (input: string): string => {
  return input.trim();
};

export const validateAmount = (amount: number): boolean => {
  return amount > 0 && amount <= 10000; 
};

export const validateCurrency = (currency: string): boolean => {
  return supportedCurrencyCodes.includes(
    currency.toUpperCase() as (typeof supportedCurrencyCodes)[number],
  );
};

export const CurrencySchema = z
  .string()
  .refine(validateCurrency, {
    message: `Unsupported currency. Accepted: ${supportedCurrencyCodes.join(", ")}`,
  })
  .transform((value) => value.toUpperCase());

export const validateFutureDatetime = (date: Date): boolean => {
  return !isNaN(date.getTime()) && date.getTime() > Date.now();
};

export const validateUnlockAt = (
  unlockAt: string | Date,
): { valid: boolean; error?: string; detail?: string } => {
  
  if (typeof unlockAt !== 'string' && !(unlockAt instanceof Date)) {
    return {
      valid: false,
      error: "unlock_at must be an ISO 8601 string or Date object",
      detail: "unlock_at must be an ISO 8601 string or Date object",
    };
  }

  
  if (typeof unlockAt === 'string') {
    
    
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/;
    if (!iso8601Regex.test(unlockAt)) {
      return {
        valid: false,
        error: "unlock_at must be a valid ISO 8601 date string with timezone and milliseconds (e.g., 2026-03-30T14:00:00.000Z or 2026-03-30T14:00:00.000+01:00)",
        detail:
          "unlock_at must be a valid ISO 8601 date string with timezone and milliseconds (e.g., 2026-03-30T14:00:00.000Z or 2026-03-30T14:00:00.000+01:00)",
      };
    }
  }

  const unlockDate = new Date(unlockAt);
  
  if (isNaN(unlockDate.getTime())) {
    return {
      valid: false,
      error: "Invalid date format for unlock_at",
      detail: "Invalid date format for unlock_at",
    };
  }
  
  const oneHourFromNow = Date.now() + 60 * 60 * 1000;
  
  if (unlockDate.getTime() < oneHourFromNow) {
    return {
      valid: false,
      error: "unlock_at must be at least 1 hour in the future",
      detail: "unlock_at must be at least 1 hour in the future",
    };
  }
  
  return { valid: true };
};


export const convertToUTCDate = (unlockAt: string | Date | null | undefined): Date | null => {
  if (!unlockAt) {
    return null;
  }

  const validation = validateUnlockAt(unlockAt);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const date = new Date(unlockAt);
  
  
  if (isNaN(date.getTime())) {
    throw new Error("Invalid date format for unlock_at");
  }

  return date;
};


export const formatAsUTCISO = (date: Date | null | undefined): string | null => {
  if (!date || isNaN(date.getTime())) {
    return null;
  }
  
  return date.toISOString();
};

export const normalizePhoneNumber = (phone: string): string => {
  return phone.replace(/[\s\-().]/g, "");
};

export const validatePhoneNumber = (phone: string): boolean => {
  const normalized = normalizePhoneNumber(phone);
  return /^\+?\d{7,15}$/.test(normalized);
};

export const sanitizePhoneNumber = (phone: string): string => {
  
  let sanitized = phone.trim();
  sanitized = normalizePhoneNumber(sanitized);
  
  
  if (!sanitized.startsWith('+')) {
    
    if (sanitized.startsWith('0')) {
      sanitized = '+234' + sanitized.substring(1);
    } else if (sanitized.startsWith('234')) {
      
      sanitized = '+' + sanitized;
    } else {
      
      sanitized = '+234' + sanitized;
    }
  }
  
  return sanitized;
};

export const validateE164PhoneNumber = (phone: string): boolean => {
  const normalized = normalizePhoneNumber(phone.trim());

  
  if (!normalized.startsWith('+') && normalized.startsWith('234')) {
    return false;
  }

  const sanitized = sanitizePhoneNumber(phone);
  
  if (!/^\+[1-9]\d{6,14}$/.test(sanitized)) {
    return false;
  }

  
  if (sanitized.startsWith('+234') && /^0+$/.test(sanitized.slice(4))) {
    return false;
  }

  return true;
};

export const validateMessage = (message: string | null | undefined): boolean => {
  if (!message) return true;
  return message.length <= 500;
};

export const CreateGiftSchema = z.object({
  recipient: z.string().min(1, "Invalid recipient ID"),
  amount: z.number(),
  currency: CurrencySchema.default("NGN"),
  message: z.string().max(500, "Message cannot exceed 500 characters").optional().nullable(),
  template: z.string().optional().nullable(),
  coverImageId: z.union([z.string(), z.number()]).optional().nullable(),
  unlock_at: z.union([z.string(), z.date()]).optional().nullable(),
  senderAvatar: z.string().refine((val) => !val || val.startsWith('http'), { message: "Invalid image URL" }).optional().nullable(),
  recipientPhone: z.string().refine((val) => !val || validateE164PhoneNumber(val), { message: "Invalid phone number format" }).optional().nullable(),
});
