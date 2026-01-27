"use client";

import { Modal, ModalHeader, ModalBody, ModalFooter } from "./Modal";
import Button from "./Button";
import Icon from "./Icon";
// import Icon from "./Icon";

interface SignupSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProceed: () => void;
}

const SignupSuccessModal = ({ isOpen, onClose, onProceed }: SignupSuccessModalProps) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalHeader
                title="Signup successful"
                icon={<Icon src="/img/cheers.svg" />}
            />
            <ModalBody
                message="start receiving surprises from the people who matter."
            />
            <ModalFooter>
                <Button onClick={onProceed} className="w-full" size="lg">
                    Proceed to dashboard
                </Button>
            </ModalFooter>
        </Modal>
    );
};

export default SignupSuccessModal;
