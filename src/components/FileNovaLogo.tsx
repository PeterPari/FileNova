export const FileNovaLogo = ({ className = "w-8 h-8", withText = false }: { className?: string, withText?: boolean }) => {
    const resolvedClass = className || (withText ? "h-8 w-auto" : "w-8 h-8");

    if (withText) {
        return (
            <img
                src="/logo.png"
                alt="FileNova"
                className={resolvedClass}
                draggable={false}
            />
        );
    }

    return (
        <img
            src="/favicon.png"
            alt="FileNova icon"
            className={resolvedClass}
            draggable={false}
        />
    );
};
