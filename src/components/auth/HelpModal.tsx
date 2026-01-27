import React from 'react';
import { X } from 'lucide-react';
import Button from '@/components/Button';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#18181B]/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl w-full max-w-md p-6 relative shadow-2xl animate-in fade-in zoom-in duration-200">
                {/* Close Icon */}
                <button
                    onClick={onClose}
                    className="absolute top-6 left-6 text-[#717182] hover:text-[#18181B] transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Icon */}
                <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 bg-[#6c5ce7]/10 rounded-full flex items-center justify-center relative">
                        <div className="w-16 h-16 bg-[#6c5ce7] rounded-full flex items-center justify-center shadow-lg transform rotate-12">
                            <span className="text-3xl filter drop-shadow-md">🤔</span>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="text-center mb-8">
                    <h3 className="text-xl font-bold text-[#18181B] mb-6">Didn't Get the Email?</h3>

                    <ul className="text-left space-y-3 text-sm text-[#52525B]">
                        <li className="flex gap-3 items-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#18181B] mt-1.5 shrink-0" />
                            <span>Check your spam or junk folder – Sometimes, emails get filtered.</span>
                        </li>
                        <li className="flex gap-3 items-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#18181B] mt-1.5 shrink-0" />
                            <span>Wait a few minutes – It may take a moment to arrive.</span>
                        </li>
                        <li className="flex gap-3 items-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#18181B] mt-1.5 shrink-0" />
                            <span>Resend the email – Tap the button to send it again.</span>
                        </li>
                        <li className="flex gap-3 items-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#18181B] mt-1.5 shrink-0" />
                            <span>Check if your email is correct – Sometimes, we make mistakes.</span>
                        </li>
                    </ul>
                </div>

                {/* Content Footer / Action */}
                <Button
                    variant="primary"
                    className="w-full py-4 text-base font-medium rounded-xl bg-[#6c5ce7] hover:bg-[#5b4bc4]"
                    onClick={onClose}
                >
                    Close
                </Button>
            </div>
        </div>
    );
};
