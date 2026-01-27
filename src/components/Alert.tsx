import React from "react";
import { X, AlertCircle, CheckCircle2 } from "lucide-react";

interface AlertProps {
    type: "success" | "error";
    message: string;
    onClose?: () => void;
}

const Alert: React.FC<AlertProps> = ({ type, message, onClose }) => {
    const isError = type === "error";

    return (
        <div
            className={`flex items-center justify-between p-4 rounded-lg border-l-4 shadow-sm mb-6 ${isError
                    ? "bg-red-50 border-red-500"
                    : "bg-green-50 border-green-500"
                }`}
        >
            <div className="flex items-center gap-3">
                {isError ? (
                    <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                        <AlertCircle className="w-4 h-4 text-red-500" />
                    </div>
                ) : (
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                    </div>
                )}
                <span className={`text-sm font-medium ${isError ? "text-gray-900" : "text-green-800"}`}>
                    {message}
                </span>
            </div>
            {onClose && (
                <button
                    onClick={onClose}
                    className={`p-1 hover:bg-black/5 rounded-full transition-colors ${isError ? "text-red-400" : "text-green-400"
                        }`}
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
};

export default Alert;
