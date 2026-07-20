import {
  validateUnlockAt,
  convertToUTCDate,
  formatAsUTCISO,
} from "@/lib/validation";

describe("Timezone-aware validation", () => {
  describe("validateUnlockAt", () => {
    it("should accept valid ISO 8601 with Z timezone", () => {
      const validDate = "2026-03-30T14:00:00.000Z";
      const result = validateUnlockAt(validDate);
      expect(result.valid).toBe(true);
    });

    it("should accept valid ISO 8601 with offset timezone", () => {
      const validDate = "2026-03-30T14:00:00.000+01:00";
      const result = validateUnlockAt(validDate);
      expect(result.valid).toBe(true);
    });

    it("should reject generic timestamp format", () => {
      const invalidDate = "2026-03-30 14:00:00";
      const result = validateUnlockAt(invalidDate);
      expect(result.valid).toBe(false);
      expect(result.detail).toContain("timezone");
    });

    it("should reject incomplete ISO format", () => {
      const invalidDate = "2026-03-30T14:00:00";
      const result = validateUnlockAt(invalidDate);
      expect(result.valid).toBe(false);
      expect(result.detail).toContain("timezone");
    });

    it("should reject non-string/non-Date inputs", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = validateUnlockAt(123 as any);
      expect(result.valid).toBe(false);
      expect(result.detail).toContain("ISO 8601 string or Date object");
    });

    it("should reject dates less than 1 hour in the future", () => {
      const thirtyMinutesFromNow = new Date(
        Date.now() + 30 * 60 * 1000,
      ).toISOString();
      const result = validateUnlockAt(thirtyMinutesFromNow);
      expect(result.valid).toBe(false);
      expect(result.detail).toContain("at least 1 hour in the future");
    });
  });

  describe("convertToUTCDate", () => {
    it("should convert valid ISO 8601 to UTC Date", () => {
      const validDate = "2026-03-30T14:00:00.000Z";
      const result = convertToUTCDate(validDate);
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(validDate);
    });

    it("should convert valid ISO 8601 with offset to UTC Date", () => {
      const validDate = "2026-03-30T14:00:00.000+01:00";
      const result = convertToUTCDate(validDate);
      expect(result).toBeInstanceOf(Date);
      // The time should be converted to UTC (13:00 UTC when it's 14:00 +01:00)
      expect(result?.toISOString()).toBe("2026-03-30T13:00:00.000Z");
    });

    it("should return null for null input", () => {
      const result = convertToUTCDate(null);
      expect(result).toBeNull();
    });

    it("should throw error for invalid format", () => {
      expect(() => convertToUTCDate("invalid-date")).toThrow();
    });
  });

  describe("formatAsUTCISO", () => {
    it("should format Date as ISO 8601 Z format", () => {
      const date = new Date("2026-03-30T14:00:00.000Z");
      const result = formatAsUTCISO(date);
      expect(result).toBe("2026-03-30T14:00:00.000Z");
    });

    it("should return null for null input", () => {
      const result = formatAsUTCISO(null);
      expect(result).toBeNull();
    });

    it("should return null for invalid date", () => {
      const result = formatAsUTCISO(new Date("invalid"));
      expect(result).toBeNull();
    });
  });
});
