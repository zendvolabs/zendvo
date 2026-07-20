"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Button from "./Button";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}


class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFF] px-4">
          <div className="max-w-md w-full bg-white rounded-[40px] shadow-[0_30px_80px_rgba(95,82,255,0.08)] p-10 text-center border border-slate-100">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-10 h-10 text-rose-500" />
            </div>
            
            <h1 className="text-2xl font-bold text-slate-900 mb-2 font-br-firma">Something went wrong</h1>
            <p className="text-slate-500 mb-8 leading-relaxed">
              We encountered an unexpected error. Don&rsquo;t worry, your gifts are safe. Please try refreshing the page.
            </p>

            <div className="flex flex-col gap-3">
              <Button 
                onClick={this.handleRefresh}
                className="w-full flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </Button>
              
              <button 
                onClick={this.handleGoHome}
                className="text-slate-500 text-sm font-medium hover:text-indigo-600 transition-colors py-2 flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" />
                Return to Home
              </button>
            </div>

            {process.env.NODE_ENV === "development" && (
              <div className="mt-8 text-left p-4 bg-slate-50 rounded-xl overflow-auto max-h-40">
                <p className="text-xs font-mono text-rose-600 font-bold mb-1">Error Details:</p>
                <p className="text-xs font-mono text-slate-600 whitespace-pre-wrap">
                  {this.state.error?.message}
                  {"\n"}
                  {this.state.error?.stack}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
