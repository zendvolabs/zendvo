"use client";

import React from "react";
import { Cake, Heart, Gem, GraduationCap, PartyPopper, HeartHandshake, LogOut, Gift } from "lucide-react";
import { clsx } from "clsx";
import { motion } from "framer-motion";

interface Category {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const categories: Category[] = [
  {
    id: "birthday",
    title: "Birthday",
    icon: Cake,
    color: "text-[#EC4899]",
    bgColor: "bg-[#FDF2F8]",
  },
  {
    id: "anniversary",
    title: "Anniversary",
    icon: Heart,
    color: "text-[#EF4444]",
    bgColor: "bg-[#FEF2F2]",
  },
  {
    id: "wedding",
    title: "Wedding",
    icon: Gem,
    color: "text-[#5A42DE]",
    bgColor: "bg-[#ECEFFE]",
  },
  {
    id: "graduation",
    title: "Graduation",
    icon: GraduationCap,
    color: "text-[#10B981]",
    bgColor: "bg-[#ECFDF5]",
  },
  {
    id: "congratulations",
    title: "Congratulations",
    icon: PartyPopper,
    color: "text-[#F59E0B]",
    bgColor: "bg-[#FFFBEB]",
  },
  {
    id: "thank-you",
    title: "Thank You",
    icon: HeartHandshake,
    color: "text-[#8B5CF6]",
    bgColor: "bg-[#F5F3FF]",
  },
  {
    id: "farewell",
    title: "Farewell",
    icon: LogOut,
    color: "text-[#6B7280]",
    bgColor: "bg-[#F3F4F6]",
  },
  {
    id: "others",
    title: "Others",
    icon: Gift,
    color: "text-[#3B82F6]",
    bgColor: "bg-[#EFF6FF]",
  },
];

interface CategoryGridProps {
  onSelect?: (categoryId: string) => void;
}

/**
 * CategoryGrid Component
 * Renders a responsive grid of gift categories with hover and active states.
 * Desktop: 4 columns
 * Mobile: 2 columns
 */
export default function CategoryGrid({ onSelect }: CategoryGridProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 justify-center"
    >
      {categories.map((category) => (
        <motion.button
          key={category.id}
          variants={itemVariants}
          whileHover={{ y: -5, transition: { duration: 0.2 } }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onSelect?.(category.id)}
          className={clsx(
            "group relative flex flex-col items-center justify-center p-6 rounded-2xl border border-[#EEEEF3] bg-white transition-all duration-300",
            "hover:border-[#5A42DE] hover:shadow-lg",
            "focus:outline-none focus:ring-2 focus:ring-[#5A42DE]/20"
          )}
        >
          <div
            className={clsx(
              "mb-4 flex size-14 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110",
              category.bgColor,
              category.color
            )}
          >
            <category.icon size={28} strokeWidth={2} />
          </div>
          <span className="text-[15px] font-semibold text-[#18181B]">
            {category.title}
          </span>
          
          {/* Subtle bottom indicator on hover */}
          <div className="absolute bottom-3 left-1/2 h-1 w-0 -translate-x-1/2 rounded-full bg-[#5A42DE] transition-all duration-300 group-hover:w-8" />
        </motion.button>
      ))}
    </motion.div>
  );
}
