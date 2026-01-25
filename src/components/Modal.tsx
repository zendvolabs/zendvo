"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

import { createPortal } from "react-dom";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
}

export const Modal = ({ isOpen, onClose, children, className }: ModalProps) => {
    const [mounted, setMounted] = React.useState(false);

    useEffect(() => {
        setMounted(true);
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-[#11172429] backdrop-blur-[12px]"
                    />
                    <motion.dialog
                        open
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className={cn(
                            "relative z-[101] w-full max-w-md overflow-hidden rounded-2xl md:rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-900 border-none space-y-4",
                            className
                        )}
                    >
                        <div className="mb-4 md:mb-8 pb-4 md:pb-0 border-b md:border-none">
                            <button
                                onClick={onClose}
                                className=""
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        {children}
                    </motion.dialog>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export const ModalHeader = ({
    title,
    icon,
    className
}: { title: string; icon?: React.ReactNode; className?: string }) => (
    <div className={cn("text-center", className)}>
        <div className="mx-auto mb-4 flex h-[66px] md:h-[120px] w-[66px] md:w-[120px] items-center justify-center rounded-full bg-primary border-[6.6px] md:border-[12px] border-white/72 mb-6">
            {icon}
        </div>
        <h2 className="text-lg font-bold text-black dark:text-white">{title}</h2>
    </div>
);

export const ModalBody = ({
    message,
    children,
    className
}: {
    message?: string;
    children?: React.ReactNode;
    className?: string
}) => (
    <div className={cn("", className)}>
        {message && <p className="text-center text-grey font-regular text-sm leading-xl max-w-4/5 mx-auto dark:text-gray-400">{message}</p>}
        {children}
    </div>
);

export const ModalFooter = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn("", className)}>{children}</div>
);

export default Modal;
