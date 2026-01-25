import React from 'react';
import MapImage from "../../../public/map.png"
import Image from 'next/image';
import giftReceivedImage from "../../../public/Gift Received .png"
import giftReceivedImage_2 from "../../../public/gift received 2.png"
import GiftsentImage from "../../../public/gift sent.png"
import { motion } from 'framer-motion';

export const WorldMapShowcase: React.FC = () => {
  return (
    <div className="relative w-full">
     <div className='max-w-148.25 mx-auto px-4'>
       {/* Headline */}
      <h2 className="md:text-5xl xl:text-6xl font-bold text-[#18181B] mb-12 text-left leading-tight">
        Receive/Send & cash gift across the globe
      </h2>
     </div>

      {/* Map Container */}
      <div className="relative w-full aspect-[1.8/1]  mx-auto">
       <Image src={MapImage} alt='map'/>

        
        
        <motion.div 
        initial={{
          opacity:0,
          scale:0,
          y:20
        }}
        animate={{
           opacity:1,
          scale:1,
          y:0
        }}
        transition={{
          duration:0.7,
          ease:"easeInOut",

        }}
        className='absolute left-5 bottom-38 xl:bottom-45'>
          <Image src={GiftsentImage.src} className='h-30 xl:h-40 w-auto ' width={GiftsentImage.width} height={GiftsentImage.height} alt='gift sent' />
        </motion.div>
        
        <motion.div 
         initial={{
          opacity:0,
          scale:0,
          y:20
        }}
        animate={{
           opacity:1,
          scale:1,
          y:0
        }}
        transition={{
          duration:0.7,
          ease:"easeInOut",
          
        }}
        className='absolute right-20 lg:bottom-38 xl:bottom-40'>
          <Image src={giftReceivedImage_2.src} className='h-30 xl:h-40 w-auto' width={giftReceivedImage_2.width} height={giftReceivedImage_2.height} alt='gift received' />
        </motion.div>


        <motion.div 
         initial={{
          opacity:0,
          scale:0,
          y:20
        }}
        animate={{
           opacity:1,
          scale:1,
          y:0
        }}
        transition={{
          duration:0.7,
          ease:"easeInOut",
          
        }}
        className='absolute right-30 lg:bottom-16 xl:bottom-17'>
          <Image src={giftReceivedImage.src} className='h-30 xl:h-40 w-auto ' width={giftReceivedImage.width} height={giftReceivedImage.height} alt='gift received' />
        </motion.div>
      </div>
    </div>
  );
};
