import Image from "next/image";


const Icon = ({ icon, src }: { icon?: React.ReactNode; src?: string }) => {
    return (
        <div className="">
            {icon}
            {src && (
                <img
                    src={src}
                    className="object-contain w-8 h-8 md:w-14 md:h-14"
                />
            )}
        </div>
    )
}

export default Icon
