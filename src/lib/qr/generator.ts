import QRCode from "qrcode";

/**
 * Logic for generating QR codes for gift sharing.
 */
export const generateGiftQRCode = async (giftUrl: string) => {
  try {
    return await QRCode.toDataURL(giftUrl);
  } catch (err) {
    console.error("QR Code generation failed", err);
    return null;
  }
};
