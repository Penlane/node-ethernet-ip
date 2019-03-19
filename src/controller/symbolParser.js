class SymbolParser {
    constructor() {
        this.parser = true;
    }

    /**
     * Parses the bitmap to an object per 1756-PM020
     * This uses hardcoded binary operators, please refer to page 49 of 1756 for explanations
     * @param {16-bit Buffer} bitmap 
     */
    parseSymbolType(bitmap) {
        const symbolObj = {};
        const securebitmap = bitmap & 0xFFFF;
        if (securebitmap & 0x8000) { // MSB for Structure Markup
            symbolObj.structureBit = "structure";
        } else {
            symbolObj.structureBit = "atomic";
        }
        /* eslint-disable indent */
        switch (securebitmap & 0x6000) { // Check Bits 14,13 für Array Size
            case 0x0000:
                symbolObj.arrayBit = "0";
                break;
            case 0x2000:
                symbolObj.arrayBit = "1";
                break;
            case 0x4000:
                symbolObj.arrayBit = "2";
                break;
            case 0x6000:
                symbolObj.arrayBit = "3";
                break;
            default:
                break;
        }

        if (securebitmap & 0x1000) { // Check Bit 12 for System Tag
            symbolObj.systemBit = "system";
        } else {
            symbolObj.systemBit = "user";
        }
        symbolObj.symbolType = securebitmap & 0b0000111111111111; // The symbol type only consists of the last 11 bits.
        return symbolObj;
    }

    checkSymbolName(nameString) {
        if (nameString.indexOf(":") > -1) {
            return "moduledef";
        } else if (nameString.indexOf("__" > -1)) {
            return "system";
        } else {
            return "user";
        }
    }

    _parseTemplateTillZero(data) {
        for (const [idx, chars] of data.entries()) {
            if (chars === 0) {
                return {
                    cutString: data.toString("ascii", 0, idx),
                    restBuf: data.slice(idx + 1, data.length),
                };
            }
        }
    }

    parseTemplate(templateAtt, templateData) {
        // 8 in following calc (1756-PM202 pg. 55f):
        // 2 Bytes info
        // 2 Bytes type
        // 4 Bytes offset
        // 0 is appended to nameBuffer in order to make parsing easier
        const nameBuffer = Buffer.concat([templateData.slice(templateAtt.memberCount * 8, templateAtt.length), Buffer.from([0])]);
        let parsedName = this._parseTemplateTillZero(nameBuffer);
        const templateObj = {
            templateName: parsedName.cutString.split(";")[0], // We got the first bit till zero, now split at the char ';'
            memberList: [],
        };
        for (let i = 0; i < templateAtt.memberCount; i++) {
            let memberObj = {};
            memberObj.info = templateData.readUInt16LE(i * 8);
            memberObj.type = templateData.readUInt16LE((i * 8) + 2);
            memberObj.offset = templateData.readUInt32LE((i * 8) + 4);
            parsedName = this._parseTemplateTillZero(parsedName.restBuf);
            if (parsedName === undefined) {
                console.log();
            }
            memberObj.asciiName = parsedName.cutString;
            templateObj.memberList.push(memberObj);
        }
        return templateObj;
    }

    parseTag() {

    }

    isUserTag(tagName) {
        if (tagName.indexOf("__") > -1) {
            return false; // System-Scope
        } else if (tagName.indexOf(":") > -1) {
            return false; // Module-Scope
        } else {
            return true; // User-Scope
        }
    }
}

module.exports = SymbolParser;