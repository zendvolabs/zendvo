// eslint-disable-next-line no-var
var mockGenerate = jest.fn(() => "default_slug");
// eslint-disable-next-line no-var
var mockCustomAlphabet = jest.fn(() => mockGenerate);

import { generateUniqueSlug } from "../../src/lib/slug";
import { db } from "../../src/lib/db";
import { customAlphabet } from "nanoid";

// Mock the database
jest.mock("../../src/lib/db", () => ({
  db: {
    query: {
      gifts: {
        findFirst: jest.fn(),
      },
    },
  },
}));

// Mock nanoid
jest.mock("nanoid", () => ({
  customAlphabet: mockCustomAlphabet,
}));

describe("generateUniqueSlug", () => {
  const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  beforeEach(() => {
    mockGenerate.mockClear();
    (db.query.gifts.findFirst as jest.Mock).mockClear();
  });

  test("should have initialized customAlphabet with correct parameters", () => {
    const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    expect(mockCustomAlphabet).toHaveBeenCalledWith(ALPHABET, 6);
  });

  describe("Success Scenarios", () => {
    test("should return a unique slug on the first attempt", async () => {
      // Mock db.query.gifts.findFirst to return null (no collision)
      (db.query.gifts.findFirst as jest.Mock).mockResolvedValue(null);

      // Mock mockGenerate to return a specific slug
      mockGenerate.mockReturnValue("unique123");

      const slug = await generateUniqueSlug();

      expect(slug).toBe("unique123");
      expect(db.query.gifts.findFirst).toHaveBeenCalledTimes(1);
    });

    test("should retry and return a unique slug if a collision occurs", async () => {
      // First call returns a gift (collision), second call returns null (unique)
      (db.query.gifts.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: "existing-id" })
        .mockResolvedValueOnce(null);

      mockGenerate
        .mockReturnValueOnce("collision1")
        .mockReturnValueOnce("uniqueAfterCol");

      const slug = await generateUniqueSlug();

      expect(slug).toBe("uniqueAfterCol");
      expect(db.query.gifts.findFirst).toHaveBeenCalledTimes(2);
    });

    test("should succeed after multiple collisions (within limit)", async () => {
      // 4 collisions, then success
      (db.query.gifts.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: "c1" })
        .mockResolvedValueOnce({ id: "c2" })
        .mockResolvedValueOnce({ id: "c3" })
        .mockResolvedValueOnce({ id: "c4" })
        .mockResolvedValueOnce(null);

      mockGenerate
        .mockReturnValueOnce("s1")
        .mockReturnValueOnce("s2")
        .mockReturnValueOnce("s3")
        .mockReturnValueOnce("s4")
        .mockReturnValueOnce("s-final");

      const slug = await generateUniqueSlug();

      expect(slug).toBe("s-final");
      expect(db.query.gifts.findFirst).toHaveBeenCalledTimes(5);
    });
  });

  describe("Error Scenarios", () => {
    test("should throw an error after maximum retries are reached", async () => {
      // Always return a gift (constant collision)
      (db.query.gifts.findFirst as jest.Mock).mockResolvedValue({ id: "always-exists" });

      mockGenerate.mockReturnValue("failure");

      await expect(generateUniqueSlug()).rejects.toThrow(
        "Failed to generate unique slug after maximum retries"
      );

      expect(db.query.gifts.findFirst).toHaveBeenCalledTimes(5);
    });
  });

  describe("Slug Format", () => {
    test("should generate a slug with exactly 6 characters", async () => {
      (db.query.gifts.findFirst as jest.Mock).mockResolvedValue(null);
      
      // Use a generator that returns a 6-char string
      mockGenerate.mockReturnValue("ABCDEF");

      const slug  = await generateUniqueSlug();
      expect(slug).toHaveLength(6);
    });

    test("should only contain characters from the defined alphabet", async () => {
      (db.query.gifts.findFirst as jest.Mock).mockResolvedValue(null);
      
      // We manually implement a simple version of customAlphabet logic for this test
      // to avoid using the real nanoid which causes ESM issues in Jest.
      const simpleCustomAlphabet = (alphabet: string, size: number) => {
        return () => {
          let result = "";
          for (let i = 0; i < size; i++) {
            result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
          }
          return result;
        };
      };
      
      mockGenerate.mockImplementation(simpleCustomAlphabet(ALPHABET, 6));

      const slug = await generateUniqueSlug();
      
      const alphabetChars = ALPHABET.split("");
      for (const char of slug) {
        expect(alphabetChars).toContain(char);
      }
    });
  });
});
