import Image from "next/image";

export default function Intro() {
    return (
        <section className="bg-[#F8F9FD] py-20 lg:py-32">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 flex flex-col lg:flex-row items-center gap-16">

                {/* Text Content */}
                <div className="w-full lg:w-1/2 order-2 lg:order-1">
                    <h2 className="text-3xl lg:text-[40px] font-bold text-gray-900 mb-8 leading-tight">
                        Introducing Zendvo: Money Gifts With Anticipation Built In
                    </h2>

                    <p className="text-gray-600 mb-6 font-medium">
                        The first platform that transforms cash into unforgettable experiences with mystery, countdown, and celebration
                    </p>

                    <h3 className="text-xl font-bold text-gray-900 mb-3">The Big Idea:</h3>
                    <p className="text-gray-600 mb-6 leading-relaxed">
                        Send money, but it's locked until the perfect moment
                    </p>

                    <p className="text-gray-600 mb-6 leading-relaxed">
                        They get notified immediately: "You have a surprise gift waiting." But they can't see how much. They can't see your message. They just see a countdown: "Unlocks in 7 days."
                    </p>

                    <p className="text-gray-600 mb-6 leading-relaxed">
                        Every day, they open the app. 6 days. 5 days. 3 days. The anticipation builds.
                    </p>

                    <p className="text-gray-600 mb-8 leading-relaxed">
                        Then the special day arrives. Midnight hits. The app lights up. Animations, confetti, your heartfelt message reveals, and the amount finally shows. They experience it like opening a gift. This is Vaultly.
                    </p>

                    <p className="font-bold text-gray-900 mt-4">This is Zendvo.</p>

                </div>

                {/* Image */}
                <div className="w-full lg:w-1/2 order-1 lg:order-2">
                    <div className="relative rounded-2xl overflow-hidden">
                        <Image
                            src="/img/intro-img.svg"
                            alt="Opening a gift"
                            width={600}
                            height={600}
                            className="w-full h-auto object-cover rounded-2xl"
                        />
                    </div>
                </div>

            </div>
        </section>
    );
}
