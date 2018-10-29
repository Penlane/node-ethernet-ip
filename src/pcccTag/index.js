const { EventEmitter } = require("events");
const crypto = require("crypto");
const { CIP } = require("../enip");
const { PCCC } = require("../enip");
const { commands, functions } = PCCC;
const { protectedTypedLogicalReadCMD, protectedTypedLogicalMaskedWriteCMD } = commands;
const { protectedTypedLogicalReadFNC, protectedTypedLogicalMaskedWriteFNC } = functions;
const { Types, getTypeCodeString, isValidTypeCode } = require("../enip/pccc/data-types");
const dateFormat = require("dateformat");

// Static Class Property - Tracks Instances
let instances = 0;
class pcccTag extends EventEmitter {
    constructor(tagname, readCount = 1, datatype = null, keepAlive = 0) {
        super();

        if (!pcccTag.isValidTagname(tagname)) throw new Error("Tagname Must be of Type <string>");
        if (!isValidTypeCode(datatype) && datatype !== null)
            throw new Error("Datatype must be a Valid Type Code <number>");
        if (readCount <= 0 || typeof readCount !== "number") throw new Error("Readcount must be a positive number");
        if (typeof keepAlive !== "number")
            throw new Error(
                `Tag expected keepAlive of type <number> instead got type <${typeof keepAlive}>`
            );
        if (keepAlive < 0)
            throw new Error(`Tag expected keepAlive to be greater than 0, got ${keepAlive}`);

        // Increment Instances
        instances += 1;
        
        const atomicRegex = new RegExp("([LFBN])(\\d{1,3})(:)(\\d{1,3})(\\/(\\d{1,2}))?");
        const atomicMatch = atomicRegex.exec(tagname);

        const tagType = PCCC.DataTypes.TypeLookUp[atomicMatch[1]];
        const tagSize = PCCC.DataTypes.SizeLookUp[atomicMatch[1]];
        /* Get all the information we can from the Match */
        const fileNumber = parseInt(atomicMatch[2]);
        const elementNumber = parseInt(atomicMatch[4]);
        const subElementNumber = parseInt(atomicMatch[6]);


        const { LOGICAL } = CIP.EPATH.segments;

        this.pcccPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x67), // PCCC class (0x67)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01), // Instance ID (0x01)
        ]);

        this.state = {
            tag: {
                name: tagname,
                type: tagType,
                fileNo: fileNumber,
                fileType: Types[tagType],
                elementNo: elementNumber,
                subElementNo: subElementNumber,
                value: null,
                controllerValue: null,
                //path: pathBuf,
                count: readCount,
                stage_write: false,
                size: tagSize
            },
            read_size: 0x01,
            error: { code: null, status: null },
            timestamp: new Date(),
            //instance: hash(pathBuf),
            keepAlive: keepAlive
        };
    }

    // region Property Accessors
    /**
     * Returns the total number of Tag Instances
     * that have been Created
     *
     * @readonly
     * @static
     * @returns {number} instances
     * @memberof pcccTag
     */
    static get instances() {
        return instances;
    }

    /**
     * Returns the Tag Instance ID
     *
     * @readonly
     * @returns {string} Instance ID
     * @memberof pcccTag
     */
    get instance_id() {
        return this.state.instance;
    }

    /**
     * Gets Tagname
     *
     * @memberof pcccTag
     * @returns {string} tagname
     */
    get name() {
        const { name } = this.state.tag;
        return name;
    }

    /**
     * Sets Tagname if Valid
     *
     * @memberof pcccTag
     * @property {string} New Tag Name
     */
    set name(name) {
        if (!pcccTag.isValidTagname(name)) throw new Error("Tagname Must be of Type <string>");
        this.state.tag.name = name;
    }

    /**
     * Gets Tag Datatype
     *
     * @memberof pcccTag
     * @returns {string} datatype
     */
    get type() {
        return getTypeCodeString(this.state.tag.type);
    }

    /**
     * Gets Tag Bit Index
     * - Returns null if no bit index has been assigned
     *
     * @memberof pcccTag
     * @returns {number} bitIndex
     */
    get bitIndex() {
        return this.state.tag.bitIndex;
    }

    /**
     * Sets Tag Datatype if Valid
     *
     * @memberof pcccTag
     * @property {number} Valid Datatype Code
     */
    set type(type) {
        if (!isValidTypeCode(type)) throw new Error("Datatype must be a Valid Type Code <number>");
        this.state.tag.type = type;
    }

    /**
     * Gets Tag Read Size
     *
     * @memberof pcccTag
     * @returns {number} read size
     */
    get read_size() {
        return this.state.read_size;
    }

    /**
     * Sets Tag Read Size
     *
     * @memberof pcccTag
     * @property {number} read size
     */
    set read_size(size) {
        if (typeof type !== "number")
            throw new Error("Read Size must be a Valid Type Code <number>");
        this.state.read_size = size;
    }

    /**
     * Gets Tag value
     * - Returns null if no value has been read
     *
     * @memberof pcccTag
     * @returns {number|string|boolean|object} value
     */
    get value() {
        return this.state.tag.value;
    }

    /**
     * Sets Tag Value
     *
     * @memberof pcccTag
     * @property {number|string|boolean|object} new value
     */
    set value(newValue) {
        this.state.tag.stage_write = true;
        this.state.tag.value = newValue;
    }

    /**
     * Sets Controller Tag Value and Emits Changed Event
     *
     * @memberof pcccTag
     * @property {number|string|boolean|object} new value
     */
    set controller_value(newValue) {
        if (newValue !== this.state.tag.controllerValue) {
            const lastValue = this.state.tag.controllerValue;
            this.state.tag.controllerValue = newValue;

            const { stage_write } = this.state.tag;
            if (!stage_write) this.state.tag.value = newValue;

            this.state.timestamp = new Date();

            if (lastValue !== null) this.emit("Changed", this, lastValue);
            else this.emit("Initialized", this);
        } else {
            if (this.state.keepAlive > 0) {
                const now = new Date();
                if (now - this.state.timestamp >= this.state.keepAlive * 1000) {
                    this.state.tag.controllerValue = newValue;

                    const { stage_write } = this.state.tag;
                    if (!stage_write) this.state.tag.value = newValue;
                    this.state.timestamp = now;

                    this.emit("KeepAlive", this);
                }
            }
        }
    }

    /**
     * Sets Controller Tag Value and Emits Changed Event
     *
     * @memberof pcccTag
     * @returns {number|string|boolean|object} new value
     */
    get controller_value() {
        return this.state.tag.controllerValue;
    }

    /**
     * Gets Timestamp in a Human Readable Format
     *
     * @readonly
     * @memberof pcccTag
     * @returns {string}
     */
    get timestamp() {
        return dateFormat(this.state.timestamp, "mm/dd/yyyy-HH:MM:ss.l");
    }

    /**
     * Gets Javascript Date Object of Timestamp
     *
     * @readonly
     * @memberof pcccTag
     * @returns {Date}
     */
    get timestamp_raw() {
        return this.state.timestamp;
    }

    /**
     * Gets Error
     *
     * @readonly
     * @memberof pcccTag
     * @returns {object|null} error
     */
    get error() {
        return this.state.error.code ? this.state.error : null;
    }

    /**
     * Returns a Padded EPATH of Tag
     *
     * @readonly
     * @returns {buffer} Padded EPATH
     * @memberof pcccTag
     */
    get path() {
        return this.state.tag.path;
    }

    /**
     * Returns a whether or not a write is staging
     *
     * @returns {boolean}
     * @memberof pcccTag
     */
    get write_ready() {
        return this.state.tag.stage_write;
    }
    // endregion

    // region Public Methods
    /**
     * Generates Read Tag Message
     *
     * @param {number} [size=null]
     * @returns {buffer} - Read Tag Message Service
     * @memberof pcccTag
     */
    generateReadMessageRequest(size = null) {
        if (size) this.state.read_size = size;

        const { tag } = this.state;

        /* Assemble the PCCC packet - see DF1 MANUAL */
        const command = Buffer.alloc(5); // 5 Bytes for the Command header
        let ptr = 0;
        command.writeUInt8(protectedTypedLogicalReadCMD, ptr);
        ptr+=1;
        command.writeUInt8(0x00,ptr); // Reserved
        ptr+=1;
        command.writeUInt16LE(0x6572,ptr); // Transaction ID - 0x7265 -> RE for READ
        ptr+=2;
        command.writeUInt8(protectedTypedLogicalReadFNC,ptr);

        const tagRequest = Buffer.alloc(6); // For request: always 5 bytes + Padding
        ptr = 0;
        tagRequest.writeUInt8(tag.size*tag.count,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.fileNo,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.fileType,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.elementNo,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.subElementNo,ptr);
        ptr+=1;
        tagRequest.writeUInt8(0x00,ptr); // Padding

        const pcccHeader = Buffer.from([0x07, 0x00, 0x00, 0x12,0x23,0x34,0x56]); // Hardcoded for each PCCC packet
        var pcccdata = 0;
        pcccdata = Buffer.concat([
            pcccHeader,
            command,
            tagRequest
        ]);

        // Message Router to Embed in UCMM
        const { EXECUTE_PCCC_SERVICE } = CIP.MessageRouter.services;
        return CIP.MessageRouter.build(EXECUTE_PCCC_SERVICE, this.pcccPath, pcccdata);
    }

    /**
     *  Parses Good Read Request Messages
     *
     * @param {buffer} Data Returned from Successful Read Tag Request
     * @memberof pcccTag
     */
    
    parseReadMessageResponse(data) {
        const { tag } = this.state;
        if (tag.count > 1) { // We are reading more than one pccc tag
            let valArray = new Array();
            for (let i = 0; i < tag.count; i++) {
                /* eslint-disable indent */
                switch (tag.type) {
                    case "INT":
                        valArray.push(data.readUInt16LE(11+i*tag.size));
                        break;
                    case "BOOL":
                        valArray.push(data.readUInt8(11+i*tag.size) >> tag.subElementNo) & 0x01; // With BOOL, we only want the sub-element!
                        break;
                    case "FLOAT":
                        valArray.push(data.readFloatLE(11+i*tag.size));
                        break;
                    default:
                        break;
                }
            }
            this.controller_value = valArray;
        }
        else { // Only one pccc tag is read
            /* eslint-disable indent */
            switch (tag.type) {
                case "INT":
                    this.controller_value = data.readUInt16LE(11);
                    break;
                case "BOOL":
                    this.controller_value = (data.readUInt8(11) >> tag.subElementNo) & 0x01; // With BOOL, we only want the sub-element!
                    break;
                case "FLOAT":
                    this.controller_value = data.readFloatLE(11);
                    break;
                default:
                    break;
            }
        }

    }

    /**
     * Generates Write Tag Message
     *
     * @param {number|boolean|object|string} [newValue=null] - If Omitted, Tag.value will be used
     * @param {number} [size=0x01]
     * @returns {buffer} - Write Tag Message Service
     * @memberof pcccTag
     */
    generateWriteMessageRequest(value = null, size = 0x01) {
        if (value !== null) this.state.tag.value = value;

        const { tag } = this.state;

        if (tag.type === null)
            throw new Error(
                `Tag ${
                    tag.name
                } has not been initialized. Try reading the tag from the controller first or manually providing a valid CIP datatype.`
            );

        if (size) this.state.read_size = size;
        let mask = 0;
        /* eslint-disable indent */
        switch (tag.type) {
            case "INT" :
            case "FLOAT":
                mask = 0xffff;
                break;
            case "BOOL":
                mask = 0x0001;
                break;
            default:
                throw new Error("No matching type detected, use only types supported");
        }

        /* Assemble the PCCC packet - see DF1 MANUAL */
        const command = Buffer.alloc(5); // 5 Bytes for the Command header
        let ptr = 0;
        command.writeUInt8(protectedTypedLogicalMaskedWriteCMD, ptr);
        ptr+=1;
        command.writeUInt8(0x00,ptr); // Reserved
        ptr+=1;
        command.writeUInt16LE(0x7277,ptr); // Transaction ID - 0x7772 -> WR for WRITE
        ptr+=2;
        command.writeUInt8(protectedTypedLogicalMaskedWriteFNC,ptr);

        const tagRequest = Buffer.alloc(5+2+tag.size*tag.count); // 5 is static header + 2 for Mask + size for actual value
        ptr = 0;
        tagRequest.writeUInt8(tag.size*tag.count,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.fileNo,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.fileType,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.elementNo,ptr);
        ptr+=1;
        tagRequest.writeUInt8(tag.subElementNo,ptr);
        ptr+=1;
        tagRequest.writeUInt16LE(mask,ptr);
        ptr+=2;
        for (let i = 0; i < tag.count; i++) {
            if (tag.type == "INT") {
                tagRequest.writeUInt16LE(value,ptr);
                ptr+=2;
            }
            else if (tag.type == "FLOAT") {
                tagRequest.writeFloatLE(value,ptr);
                ptr +=4;
            }
            else if (tag.type == "BOOL") {
                tagRequest.writeUInt8(value,ptr);
                ptr +=1;
            }
        }


        const pcccHeader = Buffer.from([0x07, 0x00, 0x00, 0x12,0x23,0x34,0x56]); // Hardcoded for each PCCC packet
        var pcccdata = 0;
        pcccdata = Buffer.concat([
            pcccHeader,
            command,
            tagRequest
        ]);

        // Message Router to Embed in UCMM
        const { EXECUTE_PCCC_SERVICE } = CIP.MessageRouter.services;
        return CIP.MessageRouter.build(EXECUTE_PCCC_SERVICE, this.pcccPath, pcccdata);
    }

    /**
     * Unstages Value Edit by Updating controllerValue
     * after the Successful Completion of 
     * a PCCC Tag Write
     *
     * @memberof pcccTag
     */
    unstageWriteRequest() {
        const { tag } = this.state;
        tag.stage_write = false;
        tag.controllerValue = tag.value; //TODO: Is this validated?
    }
    // endregion

    /**
     * Determines if a Tagname is Valid
     *
     * @static
     * @param {string} tagname
     * @returns {boolean}
     * @memberof pcccTag
     */
    static isValidTagname(tagname) {
        if (typeof tagname !== "string") return false;

        // regex components
        /*eslint no-useless-escape: "error"*/
        const atomicRegex = new RegExp("([LFBN])(\\d{1,3})(:)(\\d{1,3})(\\/(\\d{1,2}))?");
        if(!atomicRegex.test(tagname)) return false;
        // passed all tests
        return true;
    }
}

/**
 * Generates Unique ID for Each Instance
 * based on the Generated EPATH
 *
 * @param {buffer} input - EPATH of pcccTag
 * @returns {string} hash
 */
const hash = input => {
    return crypto
        .createHash("md5")
        .update(input)
        .digest("hex");
};

module.exports = pcccTag;
