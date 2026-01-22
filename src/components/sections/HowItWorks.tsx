import Image from "next/image";

export default function HowItWorks() {
    return (
        <section className="bg-[#F8F9FD] py-20 lg:py-32">
            <div className="max-w-[1440px] mx-auto bg-white px-4 sm:px-6 lg:px-12 rounded-[40px] p-8 lg:p-16 flex flex-col lg:flex-row items-center gap-12 lg:gap-24">

                {/* Phone Mockup */}
                <div className="w-full lg:w-1/2 flex justify-center">
                    <div className="relative w-full">
                        <Image
                            src="/img/how-it-works.svg"
                            alt="How it works phone demo"
                            width={600}
                            height={600}
                            className="w-full h-auto"
                        />
                    </div>
                </div>

                {/* Steps Content */}
                <div className="w-full lg:w-1/2">
                    <h2 className="text-3xl lg:text-[40px] font-bold text-gray-900 mb-4">
                        How It Works
                    </h2>
                    <p className="text-gray-600 text-lg mb-12">
                        Three Simple Steps. One Unforgettable Experience
                    </p>

                    <div className="flex flex-col gap-10 relative">
                        {/* Dotted Line */}
                        <div className="absolute left-[19px] top-4 bottom-10 w-[2px] border-l-2 border-dashed border-[#EBE9FE] hidden sm:block"></div>

                        {/* Step 1 */}
                        <div className="flex gap-6 relative z-10">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#EBE9FE] text-[#5A42DE] flex items-center justify-center font-bold text-lg">
                                1
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Create Your Surprise</h3>
                                <p className="text-gray-600 text-sm leading-relaxed">
                                    Choose any amount. Set the unlock date—their birthday, your anniversary, graduation day, or any moment that matters. Write a personal message they'll see when it opens."
                                </p>
                            </div>
                        </div>

                        {/* Step 2 */}
                        <div className="flex gap-6 relative z-10">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#EBE9FE] text-[#5A42DE] flex items-center justify-center font-bold text-lg">
                                2
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Share From YOUR Phone</h3>
                                <p className="text-gray-600 text-sm leading-relaxed">
                                    Send it via WhatsApp, Telegram, Instagram or even a QR code if you're together. It comes from YOUR account, so they know it's legit—not some random link."
                                </p>
                            </div>
                        </div>

                        {/* Step 3 */}
                        <div className="flex gap-6 relative z-10">
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#EBE9FE] text-[#5A42DE] flex items-center justify-center font-bold text-lg">
                                3
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">The Countdown Begins</h3>
                                <p className="text-gray-600 text-sm leading-relaxed">
                                    They get notified immediately but see nothing except the countdown. Days pass. Anticipation builds. Then on the special day, everything reveals with celebration animations. They withdraw to their bank in minutes."
                                </p>
                            </div>
                        </div>
                    </div>

                    <button className="mt-12 px-8 py-3.5 bg-[#5A42DE] text-white rounded-lg font-semibold w-full sm:w-auto">
                        Join the wait list
                    </button>
                </div>

            </div>
        </section>
    );
}
