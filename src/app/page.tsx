"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, Gift, Shield, Zap } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white overflow-hidden">
      {}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#5A42DE] rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">Z</span>
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900">
              Zendvo
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <Link
              href="#features"
              className="hover:text-[#5A42DE] transition-colors"
              aria-current="false"
            >
              Features
            </Link>
            <Link
              href="#how-it-works"
              className="hover:text-[#5A42DE] transition-colors"
              aria-current="false"
            >
              How it works
            </Link>
            <Link
              href="#pricing"
              className="hover:text-[#5A42DE] transition-colors"
              aria-current="false"
            >
              Pricing
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/auth/login"
              className="px-5 py-2.5 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/auth/sign-up"
              className="px-5 py-2.5 text-sm font-semibold bg-[#5A42DE] text-white rounded-full hover:bg-[#4b35e5] transition-all shadow-lg shadow-[#5A42DE]/20"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#ECEFFE] text-[#5A42DE] rounded-full text-sm font-bold">
              <Zap size={16} />
              <span>THE NEW WAY TO SEND LOVE</span>
            </div>

            <h1 className="text-6xl md:text-7xl font-bold text-[#18181B] leading-tight tracking-tighter">
              Gifting made <span className="text-[#5A42DE]">seamless</span> and
              digital.
            </h1>

            <p className="text-xl text-[#717182] max-w-lg leading-relaxed">
              Send thoughtful digital gifts to anyone, anywhere. Fast, secure,
              and personal. Experience the future of gifting today.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link
                href="/auth/sign-up"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#5A42DE] text-white rounded-2xl font-bold text-lg hover:bg-[#4b35e5] transition-all shadow-xl shadow-[#5A42DE]/30"
              >
                Send a Gift Now
                <ArrowRight size={20} />
              </Link>
              <Link
                href="#features"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-gray-700 border-2 border-gray-100 rounded-2xl font-bold text-lg hover:border-gray-200 transition-all"
              >
                See how it works
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="relative z-10 rounded-3xl overflow-hidden shadow-2xl">
              <Image
                src="https://images.unsplash.com/photo-1513885535751-8b9238bd345a?q=80&w=2070&auto=format&fit=crop"
                alt="Gifting Experience"
                width={1200}
                height={800}
                className="w-full h-auto object-cover"
              />
            </div>
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#5A42DE]/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl" />
          </motion.div>
        </div>
      </section>

      {}
      <section id="how-it-works" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4 font-br-firma">How Zendvo Works</h2>
            <p className="text-[#717182] max-w-xl mx-auto">Three simple steps to send a memory that lasts.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            {}
            <motion.div 
               whileHover={{ y: -10 }}
               className="flex flex-col items-center text-center p-8 rounded-[40px] bg-[#F8FAFF] border border-slate-50 shadow-sm"
            >
              <div className="w-16 h-16 bg-[#5A42DE] rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-6 shadow-lg shadow-[#5A42DE]/20">1</div>
              <h3 className="text-2xl font-bold mb-4">Create Your Gift</h3>
              <p className="text-[#717182]">Choose an amount, add a personal message, and pick a beautiful digital wrapper.</p>
            </motion.div>

            {}
            <motion.div 
               whileHover={{ y: -10 }}
               className="flex flex-col items-center text-center p-8 rounded-[40px] bg-[#F8FAFF] border border-slate-50 shadow-sm"
            >
              <div className="w-16 h-16 bg-[#5A42DE] rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-6 shadow-lg shadow-[#5A42DE]/20">2</div>
              <h3 className="text-2xl font-bold mb-4">Set the Unlock Date</h3>
              <p className="text-[#717182]">Decide exactly when the recipient can see and claim their gift. The mystery builds until then.</p>
            </motion.div>

            {}
            <motion.div 
               whileHover={{ y: -10 }}
               className="flex flex-col items-center text-center p-8 rounded-[40px] bg-[#F8FAFF] border border-slate-50 shadow-sm"
            >
              <div className="w-16 h-16 bg-[#5A42DE] rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-6 shadow-lg shadow-[#5A42DE]/20">3</div>
              <h3 className="text-2xl font-bold mb-4">Share the Magic</h3>
              <p className="text-[#717182]">Send the unique link. Once the timer hits zero, they can unwrap and claim straight to their wallet.</p>
            </motion.div>
          </div>
        </div>
      </section>

      {}
      <section id="testimonials" className="py-24 bg-[#F8FAFF]">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-center mb-16 font-br-firma">Loved by Givers Everywhere</h2>
          <div className="flex overflow-x-auto gap-8 pb-8 no-scrollbar">
            {[
              { name: "Adewale Y.", role: "Early Adopter", text: "Zendvo makes sending money feel like a real gift. The anticipation of the unlock date is what makes it special." },
              { name: "Chidi O.", role: "Sender", text: "The bulk gift feature is a lifesaver for our office rewards. Everyone loves the surprise reveal!" },
              { name: "Eze K.", role: "Recipient", text: "Receiving a Zendvo gift was such a fun experience. Scratching to see the message felt so personal." }
            ].map((t, i) => (
              <motion.div 
                key={i}
                className="min-w-[350px] bg-white p-8 rounded-[40px] shadow-sm border border-slate-50 flex flex-col justify-between"
                whileHover={{ scale: 1.02 }}
              >
                <p className="text-[#717182] text-lg italic mb-6">&ldquo;{t.text}&rdquo;</p>
                <div>
                  <p className="font-bold text-slate-900">{t.name}</p>
                  <p className="text-sm text-[#5A42DE] font-medium">{t.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {}
      <section id="faq" className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-4xl font-bold text-center mb-16 font-br-firma">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              { q: "How secure is Zendvo?", a: "We use bank-grade encryption and the Stellar blockchain to ensure your funds are locked and secure until the release date." },
              { q: "What currencies do you support?", a: "Currently we support NGN and USDC, allowing for stable global and local transfers." },
              { q: "Can I cancel a gift after sending?", a: "Gifts can be cancelled only if they haven't been claimed and the unlock date hasn't passed. A small processing fee may apply." }
            ].map((item, i) => (
              <details key={i} className="group bg-[#F8FAFF] rounded-[24px] overflow-hidden border border-slate-50">
                <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                  <span className="text-lg font-bold text-slate-900">{item.q}</span>
                  <span className="transition-transform group-open:rotate-180">
                    <ArrowRight className="w-5 h-5 text-[#5A42DE] rotate-90" />
                  </span>
                </summary>
                <div className="px-6 pb-6 text-[#717182] leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {}
      <footer className="py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <div className="w-6 h-6 bg-[#5A42DE] rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">Z</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-900">
              Zendvo
            </span>
          </div>
          <div className="flex gap-8 text-sm text-[#717182]">
            <Link
              href="/terms"
              className="hover:text-gray-900 transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-gray-900 transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/help"
              className="hover:text-gray-900 transition-colors"
            >
              Help
            </Link>
          </div>
          <p className="text-sm text-[#717182]">
            © 2026 Zendvo. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
