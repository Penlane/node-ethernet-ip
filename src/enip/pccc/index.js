const DataTypes = require("./data-types");


const commands = {
    protectedTypedLogicalReadCMD: 0x0F,
    protectedTypedLogicalMaskedWriteCMD: 0x0F
};

const functions = {
    protectedTypedLogicalReadFNC: 0xA2,
    protectedTypedLogicalMaskedWriteFNC: 0xAB // should be 0xAA, but only 0xAB works. 'Masked Write'
};

module.exports = { DataTypes, commands, functions };