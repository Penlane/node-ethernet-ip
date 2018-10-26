const Types = {
    STATUS: 0x84,
    BOOL: 0x85,
    TIMER: 0x86,
    COUNTER: 0x87,
    CONTROL: 0x88,
    INT: 0x89,
    FLOAT: 0x8A
};

const TypeLookUp = {
    N: "INT",
    F: "FLOAT",
    B: "BOOL",
    I: "INPUT",
    O: "OUTPUT",
    T: "TIMER",
    C: "COUNTER"
};

const SizeLookUp = {
    N: 2,
    F: 4,
    B: 1,
    I: 4,
    O: 4,
    T: 4,
    C: 4
};

/**
 * Checks if an Inputted Integer is a Valid Type Code (Vol1 Appendix C)
 * 
 * @param {number} num - Integer to be Tested 
 * @returns {boolean} 
 */
const isValidTypeCode = num => {
    if (!Number.isInteger(num)) return false;
    for (let type of Object.keys(Types)) {
        if (Types[type] === num) return true;
    }
    return false;
};

/**
 * Retrieves Human Readable Version of an Inputted Type Code
 * 
 * @param {number} num - Type Code to Request Human Readable version 
 * @returns {string} Type Code String Interpretation
 */
const getTypeCodeString = num => {
    if (!Number.isInteger(num)) return null;
    for (let type of Object.keys(Types)) {
        if (Types[type] === num) return type;
    }
    return null;
};

module.exports = { Types, TypeLookUp, SizeLookUp, isValidTypeCode, getTypeCodeString };
