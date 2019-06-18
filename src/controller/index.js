const { ENIP, CIP } = require("../enip");
const dateFormat = require("dateformat");
const TagGroup = require("../tag-group");
const Template = require("../template");
const TemplateMap = require("../template/atomics");
const { delay, promiseTimeout } = require("../utilities");
const Queue = require("task-easy");
const SymbolParser = require("./symbolParser");

const compare = (obj1, obj2) => {
    if (obj1.priority > obj2.priority) return true;
    else if (obj1.priority < obj2.priority) return false;
    else return obj1.timestamp.getTime() < obj2.timestamp.getTime();
};

class Controller extends ENIP {
    constructor(connectedMessaging = false) {
        super();

        this.state = {
            ...this.state,
            controller: {
                name: null,
                serial_number: null,
                slot: null,
                time: null,
                path: null,
                version: null,
                status: null,
                faulted: false,
                minorRecoverableFault: false,
                minorUnrecoverableFault: false,
                majorRecoverableFault: false,
                majorUnrecoverableFault: false,
                io_faulted: false
            },
            subs: new TagGroup(compare),
            scanning: false,
            scan_rate: 200, //ms,
            connectedMessaging: connectedMessaging,
            templates: TemplateMap(),
        };

        this.workers = {
            read: new Queue(compare),
            write: new Queue(compare),
            group: new Queue(compare),
            generic: new Queue(compare),
        };
    }

    // region Property Definitions

    /**
     * Gets the Controller Templates Object
     *
     * @readonly
     * @memberof Controller
     * @returns {object}
     */
    get templates() {
        return this.state.templates;
    }

    /**
     * Returns the Scan Rate of Subscription Tags
     *
     * @memberof Controller
     * @returns {number} ms
     */
    get scan_rate() {
        return this.state.scan_rate;
    }

    /**
     * Sets the Subsciption Group Scan Rate
     *
     * @memberof Controller
     */
    set scan_rate(rate) {
        if (typeof rate !== "number") throw new Error("scan_rate must be of Type <number>");
        this.state.scan_rate = Math.trunc(rate);
    }

    /**
     * Get the status of Scan Group
     *
     * @readonly
     * @memberof Controller
     */
    get scanning() {
        return this.state.scanning;
    }

    /**
     * Returns the connected / unconnected messaging mode
     *
     * @memberof Controller
     * @returns {boolean} true, if connected messaging; false, if unconnected messaging
     */
    get connectedMessaging() {
        return this.state.connectedMessaging;
    }

    /**
     * Sets the Mode to connected / unconnected messaging
     *
     * @memberof Controller
     */
    set connectedMessaging(conn) {
        if (typeof conn !== "boolean") throw new Error("connectedMessaging must be of type <boolean>");
        this.state.connectedMessaging = conn;
    }

    /**
     * Gets the Controller Properties Object
     *
     * @readonly
     * @memberof Controller
     * @returns {object}
     */
    get properties() {
        return this.state.controller;
    }

    /**
     * Fetches the last timestamp retrieved from the controller
     * in human readable form
     *
     * @readonly
     * @memberof Controller
     */
    get time() {
        return dateFormat(this.state.controller.time, "mmmm dd, yyyy - hh:MM:ss TT");
    }

    /**
     * Adds new Template to Controller Templates
     *
     * @param {object} template
     * @memberof Controller
     */
    addTemplate(template) {
        new Template(template).addToTemplates(this.state.templates);
    }
    // endregion

    // region Public Method Definitions
    /**
     * Initializes Session with Desired IP Address
     * and Returns a Promise with the Established Session ID
     *
     * @override
     * @param {string} IP_ADDR - IPv4 Address (can also accept a FQDN, provided port forwarding is configured correctly.)
     * @param {number} SLOT - Controller Slot Number (0 if CompactLogix)
     * @returns {Promise}
     * @memberof ENIP
     */
    async connect(IP_ADDR, SLOT = 0) {
        const { PORT } = CIP.EPATH.segments;
        const BACKPLANE = 1;

        this.state.controller.slot = SLOT;
        this.state.controller.path = PORT.build(BACKPLANE, SLOT);

        const sessid = await super.connect(IP_ADDR);
        if (!sessid) throw new Error("Failed to Register Session with Controller");

        this._initializeControllerEventHandlers(); // Connect sendRRData Event

        if (this.state.connectedMessaging === true) {
            const connid = await this.forwardOpen();
            if (!connid) throw new Error("Failed to Forward Open with Controller");
        }

        // Fetch Controller Properties and Wall Clock
        await this.readControllerProps();
    }
    /* For reading generic CIP Objects */
    write_cip_generic(data, connected = false, timeout = 10, cb = null) {
        //TODO: Implement Connected Version
        // We can bypass the unconnected-send encapsulation entirely. No routing to the CPU needed.
        super.write_cip(data, connected, timeout, cb);
    }

    /**
     * Disconnects the PLC instance gracefully by issuing forwardClose, UnregisterSession
     * and then destroying the socket
     * and Returns a Promise indicating a success or failure or the disconnection
     *
     * @memberof Controller
     * @returns {Promise}
     */
    async disconnect() {
        if (super.established_conn === true) {
            const closeid = await this.forwardClose();
            if (!closeid) throw new Error("Failed to Forward Open with Controller");
        }

        super.destroy();

        this._removeControllerEventHandlers();
        return "disconnected";
    }

    /**
     * Writes a forwardOpen Request and retrieves the connection ID used for
     * connected messages.
     * @memberof Controller
     * @returns {Promise}
     */
    async forwardOpen() {
        const { FORWARD_OPEN } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;
        const { owner, connectionType, fixedVar, priority } = CIP.ConnectionManager;

        // Build Connection Manager Object Logical Path Buffer
        const cmPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x06), // Connection Manager Object (0x01)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01) // Instance ID (0x01)
        ]);

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(FORWARD_OPEN, cmPath, []);

        // Create connection parameters
        const params = CIP.ConnectionManager.build_connectionParameters(owner["Exclusive"], connectionType["PointToPoint"], priority["Low"], fixedVar["Variable"], 500);

        const forwardOpenData = CIP.ConnectionManager.build_forwardOpen(10000, params);

        // Build MR Path in order to send the message to the CPU
        const mrPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x02), // Message Router Object (0x02)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01) // Instance ID (0x01)
        ]);

        // Concatenate path to CPU and how to reach the message router
        const portPath = Buffer.concat([
            this.state.controller.path,
            mrPath
        ]);

        // This is the Connection Path data unit (Vol.1 Table 3-5.21)
        const connectionPath = Buffer.concat([
            Buffer.from([Math.ceil(portPath.length / 2)]), //Path size in WORDS
            portPath
        ]);

        const forwardOpenPacket = Buffer.concat([
            MR,
            forwardOpenData,
            connectionPath
        ]);

        super.establishing_conn = true;
        super.established_conn = false;

        super.write_cip(forwardOpenPacket); // We need to bypass unconnected send for now

        const readPropsErr = new Error("TIMEOUT occurred while trying forwardOpen Request.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Forward Open", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Forward Open");

        const OTconnID = data.readUInt32LE(0); // first 4 Bytes are O->T connection ID 
        super.id_conn = OTconnID;
        super.established_conn = true;
        super.establishing_conn = false;
        return OTconnID;
    }

    /**
     * Writes a forwardClose Request and retrieves the connection ID used for
     * connected messages.
     */
    async forwardClose() {
        const { FORWARD_CLOSE } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Connection Manager Object Logical Path Buffer
        const cmPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x06), // Connection Manager Object (0x01)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01) // Instance ID (0x01)
        ]);

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(FORWARD_CLOSE, cmPath, []);

        const forwardCloseData = CIP.ConnectionManager.build_forwardClose();

        // Build MR Path in order to send the message to the CPU
        const mrPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x02), // Message Router Object (0x02)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01) // Instance ID (0x01)
        ]);

        // Concatenate path to CPU and how to reach the message router
        const portPath = Buffer.concat([
            this.state.controller.path,
            mrPath
        ]);

        // This is the Connection Path data unit (Vol.1 Table 3-5.21)
        const connectionPath = Buffer.concat([
            Buffer.from([Math.ceil(portPath.length / 2)]), //Path size in WORDS
            Buffer.from([0x00]), // Padding
            portPath
        ]);

        // Fully assembled packet
        const forwardClosePacket = Buffer.concat([
            MR,
            forwardCloseData,
            connectionPath
        ]);

        super.write_cip(forwardClosePacket); // We need to bypass unconnected send for now

        const readPropsErr = new Error("TIMEOUT occurred while trying forwardClose Request.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Forward Close", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Forward Close");

        const OTconnID = data.readUInt32LE(0); // first 4 Bytes are O->T connection ID 
        super.id_conn = OTconnID;
        super.established_conn = false;
        super.establishing_conn = true;
        return OTconnID;
    }

    executeGenericCIP(genCipParams, genCipService) {
        if (typeof genCipParams === "undefined" || typeof genCipParams !== "object") throw new Error("Provide the params in form of an Object");
        /* eslint-disable indent*/
        switch (genCipService) {
            case "readGenericSingle":
                return this.workers.generic.schedule(this._readGenericSingle.bind(this), [genCipParams.classID, genCipParams.instanceID, genCipParams.attributeID], {
                    priority: 1,
                    timestamp: new Date()
                });
            case "readGenericAll":
                return this.workers.generic.schedule(this._readGenericAll.bind(this), [genCipParams.classID, genCipParams.instanceID], {
                    priority: 1,
                    timestamp: new Date()
                });
            case "writeGenericSingle":
                return this.workers.generic.schedule(this._writeGenericSingle.bind(this), [
                    genCipParams.classID,
                    genCipParams.instanceID,
                    genCipParams.attributeID,
                    genCipParams.writeData], {
                        priority: 1,
                        timestamp: new Date()
                    });
            case "writeGenericAll":
                return this.workers.generic.schedule(this._writeGenericSingle.bind(this), [
                    genCipParams.classID,
                    genCipParams.instanceID,
                    genCipParams.writeData], {
                        priority: 1,
                        timestamp: new Date()
                    });
            case "readStatus":
                return this.workers.generic.schedule(this.readControllerProps.bind(this), [], {
                    priority: 1,
                    timestamp: new Date()
                });
            default:
                throw new Error("Provide a valid Service");
        }
    }

    /**
     * Reads a all entities (class/instance/attribute) from a generic CIP object
     *
     * @param {number} classID - The ClassID of the requested object
     * @param {number} instanceID - The InstanceID of the requested object
     * @param {number} attributeID - The AttributeID of the requested object
     * @memberof Controller
     * @returns {Promise}
     */
    async _readGenericAll(classID, instanceID, attributeID) {
        if (classID <= 0 || typeof classID !== "number") throw new Error("ClassID needs to be positive and a number");
        if (instanceID != undefined && (instanceID <= 0 || typeof instanceID !== "number")) throw new Error("InstanceID needs to be positive and a number");
        if (attributeID != undefined && (attributeID <= 0 || typeof instanceID !== "number")) throw new Error("AttributeID needs to be positive and a number");

        const { GET_ATTRIBUTE_ALL } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        let identityPath = LOGICAL.build(LOGICAL.types.ClassID, classID); // Object
        if (instanceID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.InstanceID, instanceID)]); // Instance 
        if (attributeID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.AttributeID, attributeID)]); // Attribute

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(GET_ATTRIBUTE_ALL, identityPath, []);

        this.write_cip_generic(MR);

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Props.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Get Attribute All", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Get Attribute All");

        return data;
    }

    /**
     * Reads a single entity (class/instance/attribute) from a generic CIP object
     *
     * @param {number} classID - The ClassID of the requested object
     * @param {number} instanceID - The InstanceID of the requested object
     * @param {number} attributeID - The AttributeID of the requested object
     * @memberof Controller
     * @returns {Promise}
     */
    async _readGenericSingle(classID, instanceID, attributeID) {
        if (classID <= 0 || typeof classID !== "number") throw new Error("ClassID needs to be positive and a number");
        if (instanceID != undefined && (instanceID <= 0 || typeof instanceID !== "number")) throw new Error("InstanceID needs to be positive and a number");
        if (attributeID != undefined && (attributeID <= 0 || typeof instanceID !== "number")) throw new Error("AttributeID needs to be positive and a number");

        const { GET_ATTRIBUTE_SINGLE } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        let identityPath = LOGICAL.build(LOGICAL.types.ClassID, classID); // Object
        if (instanceID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.InstanceID, instanceID)]); // Instance 
        if (attributeID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.AttributeID, attributeID)]); // Attribute

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(GET_ATTRIBUTE_SINGLE, identityPath, []);

        this.write_cip_generic(MR);

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Props.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Get Attribute Single", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Get Attribute Single");

        return data;
    }

    /**
     * Write all attributes of a generic CIP object
     *
     * @param {number} classID - The ClassID of the requested object
     * @param {number} instanceID - The InstanceID of the requested object
     * @param {number} attributeID - The AttributeID of the requested object
     * @param {buffer} writeData - A buffer with data that is to be written to the CIP object <- This is object specific!
     * @memberof Controller
     * @returns {Promise}
     */
    async _writeGenericAll(classID, instanceID, writeData) {
        if (classID <= 0 || typeof classID !== "number") throw new Error("ClassID needs to be positive and a number");
        if (instanceID != undefined && (instanceID <= 0 || typeof instanceID !== "number")) throw new Error("InstanceID needs to be positive and a number");
        if (writeData == undefined || (!Buffer.isBuffer(writeData))) throw new Error("writeData Must be of Type Buffer");

        const { SET_ATTRIBUTE_ALL } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        let identityPath = LOGICAL.build(LOGICAL.types.ClassID, classID); // Object
        if (instanceID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.InstanceID, instanceID)]); // Instance 

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(SET_ATTRIBUTE_ALL, identityPath, writeData);

        this.write_cip_generic(MR);

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Props.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Set Attribute All", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Set Attribute Single");

        return data;
    }

    /**
     * Writes to a generic CIP object
     *
     * @param {number} classID - The ClassID of the requested object
     * @param {number} instanceID - The InstanceID of the requested object
     * @param {number} attributeID - The AttributeID of the requested object
     * @param {buffer} writeData - A buffer with data that is to be written to the CIP object <- This is object specific!
     * @memberof Controller
     * @returns {Promise}
     */
    async _writeGenericSingle(classID, instanceID, attributeID, writeData) {
        if (classID <= 0 || typeof classID !== "number") throw new Error("ClassID needs to be positive and a number");
        if (instanceID != undefined && (instanceID <= 0 || typeof instanceID !== "number")) throw new Error("InstanceID needs to be positive and a number");
        if (attributeID != undefined && (attributeID <= 0 || typeof instanceID !== "number")) throw new Error("AttributeID needs to be positive and a number");
        if (writeData == undefined || (!Buffer.isBuffer(writeData))) throw new Error("writeData Must be of Type Buffer");

        const { SET_ATTRIBUTE_SINGLE } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        let identityPath = LOGICAL.build(LOGICAL.types.ClassID, classID); // Object
        if (instanceID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.InstanceID, instanceID)]); // Instance 
        if (attributeID) identityPath = Buffer.concat([identityPath, LOGICAL.build(LOGICAL.types.AttributeID, attributeID)]); // Attribute

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(SET_ATTRIBUTE_SINGLE, identityPath, writeData);

        this.write_cip_generic(MR);

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Props.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Set Attribute Single", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Set Attribute Single");

        return data;
    }

    /**
     * Writes Ethernet/IP Data to Socket as an Unconnected Message
     * or a Transport Class 1 Datagram
     *
     * NOTE: Cant Override Socket Write due to net.Socket.write
     *        implementation. =[. Thus, I am spinning up a new Method to
     *        handle it. Dont Use Enip.write, use this function instead.
     *
     * @override
     * @param {buffer} data - Message Router Packet Buffer
     * @param {boolean} [connected=false]
     * @param {number} [timeout=10] - Timeout (sec)
     * @param {function} [cb=null] - Callback to be Passed to Parent.Write()
     * @memberof ENIP
     */
    write_cip(data, timeout = 10, cb = null) {
        const { UnconnectedSend } = CIP;
        let msg;
        const connected = super.established_conn;
        if (connected === false) {
            msg = UnconnectedSend.build(data, this.state.controller.path);
        } else {
            msg = data;
        }
        super.write_cip(msg, connected, timeout, cb);
    }

    /**
     * Reads Controller Identity Object
     *
     * @memberof Controller
     * @returns {Promise}
     */
    async readControllerProps() {
        const { GET_ATTRIBUTE_ALL } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        const identityPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x01), // Identity Object (0x01)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01) // Instance ID (0x01)
        ]);

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(GET_ATTRIBUTE_ALL, identityPath, []);

        this.write_cip(MR);

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Props.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Get Attribute All", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners("Get Attribute All");

        // Parse Returned Buffer
        this.state.controller.serial_number = data.readUInt32LE(10);

        const nameBuf = Buffer.alloc(data.length - 15);
        data.copy(nameBuf, 0, 15);

        this.state.controller.name = nameBuf.toString("utf8");

        const major = data.readUInt8(6);
        const minor = data.readUInt8(7);
        this.state.controller.version = `${major}.${minor}`;

        let status = data.readUInt16LE(8);
        this.state.controller.status = status;

        status &= 0x0ff0;
        this.state.controller.faulted = (status & 0x0f00) === 0 ? false : true;
        this.state.controller.minorRecoverableFault = (status & 0x0100) === 0 ? false : true;
        this.state.controller.minorUnrecoverableFault = (status & 0x0200) === 0 ? false : true;
        this.state.controller.majorRecoverableFault = (status & 0x0400) === 0 ? false : true;
        this.state.controller.majorUnrecoverableFault = (status & 0x0800) === 0 ? false : true;

        status &= 0x0f00;
        this.state.controller.io_faulted = status >> 4 === 2 ? true : false;
        this.state.controller.faulted = status >> 4 === 2 ? true : this.state.controller.faulted;
    }

    /**
     * Reads the Controller Wall Clock Object
     *
     * @memberof Controller
     * @returns {Promise}
     */
    async readWallClock() {
        let service;
        let serviceStr;
        let tempName;
        const { GET_ATTRIBUTE_LIST, GET_ATTRIBUTE_SINGLE } = CIP.MessageRouter.services;
        if (this.state.controller.name.search("L8") !== -1) {
            service = GET_ATTRIBUTE_SINGLE;
            serviceStr = "Get Attribute Single";
            tempName = "L8";
        }
        else if (this.state.controller.name.search("L32") !== -1) {
            service = GET_ATTRIBUTE_LIST;
            serviceStr = "Get Attribute List";
            tempName = "L32";
        }
        else {
            throw new Error("WallClock Utilities are not supported by this controller type");
        }
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer
        let identityPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x8b), // WallClock Object (0x8B)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01), // Instance ID (0x01)
        ]);

        let MR; // Container for the Embedded Packet
        // If we are either Micro800 or L8 CPU, we can access this via Attribute
        if (tempName === "L8") {
            identityPath = Buffer.concat([
                identityPath,
                LOGICAL.build(LOGICAL.types.AttributeID, 0x0b),
            ]);
            // Message Router to Embed in UCMM
            MR = CIP.MessageRouter.build(service, identityPath, []);
            this.write_cip_generic(MR);
        } else if (tempName === "L32") {
            const timeRequest = Buffer.concat([
                Buffer([0x01, 0x00]), //Attribute Count
                Buffer([0x0b, 0x00]), //Local Time
            ]);
            // Message Router to Embed in UCMM
            MR = CIP.MessageRouter.build(service, identityPath, timeRequest);
            this.write_cip(MR);

        }

        const readPropsErr = new Error("TIMEOUT occurred while reading Controller Clock.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on(serviceStr, (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readPropsErr
        );

        this.removeAllListeners(serviceStr);

        let date;
        if (tempName === "L8") {
            // Parse Returned Buffer
            let wallClockArray = [];
            for (let i = 0; i < 7; i++) {
                wallClockArray.push(data.readUInt32LE(i * 4));
            }

            // Massage Data to JS Date Friendly Format
            wallClockArray[6] = Math.trunc(wallClockArray[6] / 1000); // convert to ms from us
            wallClockArray[1] -= 1; // month is 0-based

            date = new Date(...wallClockArray);
        } else if (tempName === "L32") {
            const offset = 6; // this is where the 64-bit time actually starts
            const utcMicros = data.readInt32LE(offset) + 0x100000000 * data.readUInt32LE(offset + 4);
            date = new Date(utcMicros / 1000);
        }

        this.state.controller.time = date;
    }

    /**
     * Write to PLC Wall Clock
     *
     * @param {Date} [date=new Date()]
     * @memberof Controller
     * @returns {Promise}
     */
    async writeWallClock(date = new Date()) {
        if (this.state.controller.name.search("L8") === -1)
            throw new Error("WallClock Utilities are not supported by this controller type");

        const { SET_ATTRIBUTE_SINGLE } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;
        const arr = [];

        arr.push(date.getFullYear());
        arr.push(date.getMonth() + 1);
        arr.push(date.getDate());
        arr.push(date.getHours());
        arr.push(date.getMinutes());
        arr.push(date.getSeconds());
        arr.push(date.getMilliseconds() * 1000);

        let buf = Buffer.alloc(28);
        for (let i = 0; i < 7; i++) {
            buf.writeUInt32LE(arr[i], 4 * i);
        }

        // Build Identity Object Logical Path Buffer
        const identityPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x8b), // WallClock Object (0x8B)
            LOGICAL.build(LOGICAL.types.InstanceID, 0x01), // Instance ID (0x01)
            LOGICAL.build(LOGICAL.types.AttributeID, 0x05) // Local Time Attribute ID
        ]);

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(SET_ATTRIBUTE_SINGLE, identityPath, buf);

        this.write_cip(MR);

        const writeClockErr = new Error("TIMEOUT occurred while writing Controller Clock.");

        // Wait for Response
        await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Set Attribute Single", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            writeClockErr
        );

        this.removeAllListeners("Set Attribute Single");

        this.state.controller.time = date;
    }

    async _readTemplate(symbolType) {
        const { READ_TEMPLATE } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;
        const { getTypeCodeString } = require("../enip/cip/data-types");
        const templateAtt = await this._getTemplateMarkup(symbolType);
        let memberOffset = 0; // by this offset, we mean the offset of the readTemplate service
        let stillReading = true;
        let parser = new SymbolParser();
        let fullData;

        // Initialize service-dependent buffers
        const templateRequest = Buffer.alloc(6); // 4 Bytes for offset, 2 bytes for Object size
        let MR; // The message router packet
        const magicFormula = (templateAtt.objDefinitionSize * 4) - 23; // - 23; // 1756-PM020 p.53
        let remainingBytes = 0; // If we read a large packet, we need this diff to tell us how many bytes are remaining
        // Build Identity Object Logical Path Buffer per 1756-PM020 p. 51f
        const identityPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x6C), // Template Object (0x6C)
            LOGICAL.build(LOGICAL.types.InstanceID, symbolType), // Instance ID (0x0)
        ]);
        const readTemplateErr = new Error("TIMEOUT occurred while reading Template.");
        let data;
        while (stillReading === true) {
            // Build the request per 1756-PM020 p. 51f
            templateRequest.writeUInt32LE(memberOffset, 0);
            if (memberOffset === 0) {
                templateRequest.writeUInt16LE(magicFormula, 4);
            }
            else {
                templateRequest.writeUInt16LE(remainingBytes, 4);
            }


            // Message Router to Embed in UCMM
            MR = CIP.MessageRouter.build(READ_TEMPLATE, identityPath, templateRequest);

            this.write_cip(MR);

            // Wait for Response
            data = await promiseTimeout(
                new Promise((resolve, reject) => {
                    this.on("Read Template", (err, data) => {
                        if (err) // check what kind of error we got
                        {
                            if (err.generalStatusCode == 6) // that's fine! We just need to read more.
                            {
                                //reject(err);
                                console.log("Need more requests");
                                resolve(data);
                                stillReading = true;
                            } else if (err.generalStatusCode === 0xFF) {
                                console.log("General Error: Access beyond end of the object.");
                                reject(err);
                                stillReading = false;
                            }
                            else {
                                reject(err);
                                stillReading = false;
                            }
                        }
                        else {
                            resolve(data);
                            stillReading = false;
                        }
                    });
                }),
                10000,
                readTemplateErr
            );

            this.removeAllListeners("Read Template");
            memberOffset = data.length;
            remainingBytes = magicFormula - memberOffset;
            if (fullData === undefined) {
                fullData = data;
            } else {
                fullData = Buffer.concat([fullData, data]);
            }
        }

        const templateObj = parser.parseTemplate(templateAtt, fullData);
        let structure;
        for (const members of templateObj.memberList) {
            var symbolObj = parser.parseSymbolType(members.type);
            if (symbolObj.structureBit === "structure") {
                structure = await this._readTemplate(symbolObj.symbolType);
                members.type = structure;
            } else {
                structure = getTypeCodeString(symbolObj.symbolType);
                if (symbolObj.arrayBit !== "0") {
                    // Following lines don't matter for UDTs! We have the Array-structure in the .info property
                    /* eslint-disable indent */
                    // switch (symbolObj.arrayBit) {
                    //     case "1":
                    //         members.type = `${getTypeCodeString(symbolObj.symbolType & 0xFF)}[${members.info}]`;
                    //         break;
                    //     case "2":
                    //         throw new Error("Only single dimension Arrays allowed in UDTs");
                    //     case "3":
                    //         throw new Error("Only single dimension Arrays allowed in UDTs");
                    //     default:
                    //         members.type = `${getTypeCodeString(symbolObj.symbolType & 0xFF)}[${members.info}]`;
                    //         break;
                    // }
                    members.type = getTypeCodeString(symbolObj.symbolType & 0xFF);
                } else {
                    if (getTypeCodeString(symbolObj.symbolType & 0xFF) !== null) {
                        members.type = getTypeCodeString(symbolObj.symbolType & 0xFF);
                    }
                }
            }
            if (members.type === "BIT_STRING") {
                members.type = "BOOL";
                members.info = members.info * 32;
            }
        }
        return templateObj;
    }

    /**
     * Retrieves the Template markup of a Symbol-Type per 1756-PM020 p. 52
     * @param {number} symbolType - The symboltype  
     * @returns {Object} 
     *  const templateAttributes = {
     *      objDefinitionSize: number,
     *      structSize: number,
     *      memberCount: number,
     *      structHandle: number,
     *  };
     */
    async _getTemplateMarkup(symbolType) {
        const { GET_ATTRIBUTE_LIST } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;

        // Build Identity Object Logical Path Buffer per 1756-PM020 p. 51f
        const identityPath = Buffer.concat([
            LOGICAL.build(LOGICAL.types.ClassID, 0x6C), // Template Object (0x6C)
            LOGICAL.build(LOGICAL.types.InstanceID, symbolType), // Instance ID (0x0)
        ]);

        // Build the request per 1756-PM020 p. 51f
        const templateRequest = Buffer.concat([
            Buffer([0x04, 0x00]), //Attribute Count
            Buffer([0x04, 0x00]), //Template Definition Size
            Buffer([0x05, 0x00]), //Template Structure Size (Data)
            Buffer([0x02, 0x00]), //Template Member Count
            Buffer([0x01, 0x00]) //Structure Handle
        ]);

        // Message Router to Embed in UCMM
        const MR = CIP.MessageRouter.build(GET_ATTRIBUTE_LIST, identityPath, templateRequest);

        this.write_cip(MR);

        const readTemplateErr = new Error("TIMEOUT occurred while reading Template Markup.");

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Get Attribute List", (err, data) => {
                    if (err) // check what kind of error we got
                    {
                        if (err.generalStatusCode == 6) // that's fine! We just need to read more.
                        {
                            console.log("Need more requests");
                        }
                        else {
                            reject(err);
                        }
                    }
                    else {
                        resolve(data);
                    }
                });
            }),
            10000,
            readTemplateErr
        );

        this.removeAllListeners("Get Attribute List");

        // 1756-PM020 p. 52!
        const templateAttributes = {
            objDefinitionSize: data.readUInt32LE(6),
            structSize: data.readUInt32LE(14),
            memberCount: data.readUInt16LE(22),
            structHandle: data.readUInt16LE(28)
        };
        return templateAttributes;
        //return await this._readTemplate(symbolType, templateAttributes);

    }


    async _readTagList(program = "Controller") {

        // Not sure where to put this, but we only need it here!
        function isUserTag(tagName) {
            if (tagName.indexOf("__") > -1) {
                return false; // System-Scope
            } else if (tagName.indexOf(":") > -1) {
                return false; // Module-Scope
            } else {
                return true; // User-Scope
            }
        }

        const { GET_INSTANCE_ATTRIBUTE_LIST } = CIP.MessageRouter.services;
        const { LOGICAL } = CIP.EPATH.segments;
        const { getTypeCodeString } = require("../enip/cip/data-types");

        let instanceID = 0;
        var tagList = [];
        var tagListFull = [];
        var programList = [];
        let stillReading = true;
        let parser = new SymbolParser();
        let identityPath;

        while (stillReading == true) {
            if (program !== "Controller") {
                let programNameBytes = Buffer.from(program);
                // Build Identity Object Logical Path Buffer
                var mylen = programNameBytes.length;
                identityPath = Buffer.concat([
                    Buffer.from([0x91, mylen]),
                    programNameBytes
                ]);
                if (mylen % 2) //Padding if programName is not even
                {
                    identityPath = Buffer.concat([
                        identityPath,
                        Buffer.from([0x00])
                    ]);
                }
                identityPath = Buffer.concat([
                    identityPath,
                    LOGICAL.build(LOGICAL.types.ClassID, 0x6B), // Symbol Object (0x6B)
                    LOGICAL.build(LOGICAL.types.InstanceID, instanceID), // Instance ID (0x0)
                ]);
            } else {
                // Build Identity Object Logical Path Buffer
                identityPath = Buffer.concat([
                    LOGICAL.build(LOGICAL.types.ClassID, 0x6B), // Symbol Object (0x6B)
                    LOGICAL.build(LOGICAL.types.InstanceID, instanceID), // Instance ID (0x0)
                ]);
            }

            var tagListRequest = 0;
            tagListRequest = Buffer.concat([
                Buffer([0x04, 0x00]), //Attribute Count - change to 3 with Byte Count
                Buffer([0x01, 0x00]), //Symbol Type
                Buffer([0x02, 0x00]), //Symbol Name
                Buffer([0x07, 0x00]), //Byte Count - not needed currently
                Buffer([0x08, 0x00]), //Array Markup
            ]);
            // Message Router to Embed in UCMM
            const MR = CIP.MessageRouter.build(GET_INSTANCE_ATTRIBUTE_LIST, identityPath, tagListRequest);

            this.write_cip(MR);

            const readTagListErr = new Error("TIMEOUT occurred while reading TagList.");

            // Wait for Response
            const data = await promiseTimeout(
                new Promise((resolve, reject) => {
                    this.on("Get Instance Attribute List", (err, data) => {
                        if (err) // check what kind of error we got
                        {
                            if (err.generalStatusCode == 6) // that's fine! We just need to read more.
                            {
                                stillReading = true;
                            }
                            else {
                                stillReading = false;
                                reject(err);
                            }
                        }
                        else {
                            stillReading = false;
                        }
                        resolve(data);
                    });
                }),
                10000,
                readTagListErr
            );
            this.removeAllListeners("Get Instance Attribute List");

            // The markup of the response is as follows:
            // 4 Byte Instance-ID
            // 2 Byte Name-Length
            // n Byte Ascii-Name (see previous Name-length)
            // 2 Byte Symbol Type
            // 2 Byte Byte Count
            // n* 4 Byte Array Markup
            // ...rinse and repeat
            let tagNameAscii;
            let ptr = 0;
            while (ptr < data.length - 5) // -5, because we don't want to read past the packet
            {
                instanceID = data.readUInt32LE(ptr); // we read the PLC-Offset first
                ptr += 4;
                let nameLength = data.readUInt16LE(ptr);
                ptr += 2;
                let tagNameBytes = Buffer.alloc(nameLength);
                let tagNameOffset = ptr;
                for (ptr; ptr < tagNameOffset + nameLength; ptr++) // we read from start of packetName to end of packetName
                {
                    if (ptr < data.length) {
                        tagNameBytes[ptr - tagNameOffset] = data.readUInt8(ptr); // Fill a buffer with the tagName
                    }
                    else {
                        console.log("Finished with packet");
                    }
                }
                var symbolType = data.readUInt16LE(ptr);
                ptr += 2;
                var bytecount = data.readUInt16LE(ptr);
                ptr += 2;
                var struct1 = data.readUInt32LE(ptr);
                ptr += 4;
                var struct2 = data.readUInt32LE(ptr);
                ptr += 4;
                var struct3 = data.readUInt32LE(ptr);
                ptr += 4;
                tagNameAscii = tagNameBytes.toString();
                if (tagNameAscii.indexOf("Program:") > -1) {
                    programList.push(tagNameAscii); // Program-Scope
                } else if (tagNameAscii.indexOf("Routine:mymain") > -1) {
                    // console.log("Found a routine");
                } else {
                    let asciiType = getTypeCodeString(symbolType);
                    let symbolObj = parser.parseSymbolType(symbolType);
                    let templateObject = null; // If we have only a templateObject, we use that. If we have both, prefer asciiType
                    if (isUserTag(tagNameAscii)) {
                        if (asciiType === null) {
                            if (symbolObj.systemBit === "user" && symbolObj.structureBit === "structure") { // We cannot parse System-Templates yet
                                templateObject = await this._readTemplate(symbolObj.symbolType);
                                // console.log("Read Template");
                            }
                            if (symbolObj.arrayBit !== "0") {
                                /* eslint-disable indent */
                                switch (symbolObj.arrayBit) {
                                    case "1":
                                        asciiType = `${(typeof templateObject === "object" && templateObject !== null) ? templateObject.templateName : getTypeCodeString(symbolType & 0xFF)}[${struct1}]`;
                                        break;
                                    case "2":
                                        asciiType = `${(typeof templateObject === "object" && templateObject !== null) ? templateObject.templateName : getTypeCodeString(symbolType & 0xFF)}[${struct1},${struct2}]`;
                                        break;
                                    case "3":
                                        asciiType = `${(typeof templateObject === "object" && templateObject !== null) ? templateObject.templateName : getTypeCodeString(symbolType & 0xFF)}[${struct1},${struct2},${struct3}]`;
                                        break;
                                    default:
                                        asciiType = "ERRType in Array";
                                        break;
                                }
                            }
                        }
                        if (asciiType !== null && !(tagNameAscii.indexOf("ZZZZZZZZZ") >= 0) || templateObject !== null) {
                            // FIXME: Rework this section to remove all the nested conditionals. The logic is ok.
                            if (asciiType !== null) {
                                if (asciiType.indexOf("BIT_STRING") >= 0) {
                                    asciiType = `BOOL[${struct1 * 32}]`;
                                }
                                if (!(asciiType.indexOf("[") >= 0)) {
                                    tagList.push({ tagName: tagNameAscii, symbolType: asciiType || templateObject });
                                }
                            } else {
                                tagList.push({ tagName: tagNameAscii, symbolType: asciiType || templateObject });
                            }

                        }
                    }
                    tagListFull.push({ tagName: tagNameAscii, symbolType: asciiType || templateObject });
                }

            }
            if (ptr < data.length) {
                instanceID = data.readUInt16LE(ptr);
            }
        }
        return {
            progList: programList,
            tagObjList: tagList,
        };
    }

    /**
     * Reads the Controller TagList
     *
     * @memberof Controller
     * @returns {Promise}
     */
    async readTagList() {
        let retList = {};
        let retObj = await this._readTagList();
        retList["Controller"] = retObj.tagObjList;
        for (const programs of retObj.progList) {
            retObj = await this._readTagList(programs);
            retList[programs] = retObj.tagObjList;
        }
        //console.log(retList);
        const symP = new SymbolParser();
        const tempList = symP.filterTemplates(retList);
        const sortTempList = symP.sortNestedTemplates(tempList);
        const templateList = sortTempList;
        const tagList = symP.adjustTagListFormat(retList);
        return { tagList, templateList };
    }

    /**
     * Reads Value of Tag and Type from Controller
     *
     * @param {Tag} tag - Tag Object to Write
     * @param {number} [size=null]
     * @returns {Promise}
     * @memberof Controller
     */
    readTag(tag, size = null) {
        return this.workers.read.schedule(this._readTag.bind(this), [tag, size], {
            priority: 1,
            timestamp: new Date()
        });
    }

    /**
     * Writes value to Tag
     *
     * @param {Tag} tag - Tag Object to Write
     * @param {number|boolean|object|string} [value=null] - If Omitted, Tag.value will be used
     * @param {number} [size=0x01]
     * @returns {Promise}
     * @memberof Controller
     */
    writeTag(tag, value = null, size = 0x01) {
        return this.workers.write.schedule(this._writeTag.bind(this), [tag, value, size], {
            priority: 1,
            timestamp: new Date()
        });
    }

    /**
     * Reads All Tags in the Passed Tag Group
     *
     * @param {TagGroup} group
     * @returns {Promise}
     * @memberof Controller
     */
    readTagGroup(group) {
        return this.workers.group.schedule(this._readTagGroup.bind(this), [group], {
            priority: 1,
            timestamp: new Date()
        });
    }

    /**
     * Writes to Tag Group Tags
     *
     * @param {TAgGroup} group
     * @returns {Promise}
     * @memberof Controller
     */
    writeTagGroup(group) {
        return this.workers.group.schedule(this._writeTagGroup.bind(this), [group], {
            priority: 1,
            timestamp: new Date()
        });
    }

    /**
     * Adds Tag to Subscription Group
     *
     * @param {Tagany} tag
     * @memberof Controller
     */
    subscribe(tag) {
        this.state.subs.add(tag);
    }

    /**
     * Begin Scanning Subscription Group
     *
     * @memberof Controller
     */
    async scan() {
        this.state.scanning = true;

        while (this.state.scanning) {
            await this.workers.group
                .schedule(this._readTagGroup.bind(this), [this.state.subs], {
                    priority: 10,
                    timestamp: new Date()
                })
                .catch(e => {
                    if (e.message) {
                        throw new Error(`<SCAN_GROUP>\n ${e.message}`);
                    } else {
                        throw e;
                    }
                });

            await this.workers.group
                .schedule(this._writeTagGroup.bind(this), [this.state.subs], {
                    priority: 10,
                    timestamp: new Date()
                })
                .catch(e => {
                    if (e.message) {
                        throw new Error(`<SCAN_GROUP>\n ${e.message}`);
                    } else {
                        throw e;
                    }
                });

            await delay(this.state.scan_rate);
        }
    }

    /**
     * Pauses Scanning of Subscription Group
     *
     * @memberof Controller
     */
    pauseScan() {
        this.state.scanning = false;
    }

    /**
     * Iterates of each tag in Subscription Group
     *
     * @param {function} callback
     * @memberof Controller
     */
    forEach(callback) {
        this.state.subs.forEach(callback);
    }
    // endregion

    // region Private Methods
    /**
     * Initialized Controller Specific Event Handlers
     *
     * @memberof Controller
     */
    _initializeControllerEventHandlers() {
        this.on("SendRRData Received", this._handleSendRRDataReceived);
        this.on("SendUnitData Received", this._handleSendUnitDataReceived);
    }

    // region Private Methods
    /**
     * Remove Controller Specific Event Handlers
     *
     * @memberof Controller
     */
    _removeControllerEventHandlers() {
        this.removeAllListeners("SendRRData Received");
        this.removeAllListeners("SendUnitData Received");
    }

    /**
     * Reads Value of Tag and Type from Controller
     *
     * @param {Tag} tag - Tag Object to Write
     * @param {number} [size=null]
     * @returns {Promise}
     * @memberof Controller
     */
    async _readTag(tag, size = null) {
        tag.controller = this;

        const MR = tag.generateReadMessageRequest(size);

        this.write_cip(MR);

        const readTagErr = new Error(`TIMEOUT occurred while reading Tag: ${tag.name}.`);

        // Wait for Response
        const data = await promiseTimeout(
            new Promise((resolve, reject) => {
                this.on("Read Tag", (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            }),
            10000,
            readTagErr
        );

        this.removeAllListeners("Read Tag");

        tag.parseReadMessageResponse(data);
    }

    /**
     * Writes value to Tag
     *
     * @param {Tag} tag - Tag Object to Write
     * @param {number|boolean|object|string} [value=null] - If Omitted, Tag.value will be used
     * @param {number} [size=0x01]
     * @returns {Promise}
     * @memberof Controller
     */
    async _writeTag(tag, value = null, size = 0x01) {
        tag.controller = this;

        const MR = tag.generateWriteMessageRequest(value, size);

        this.write_cip(MR);

        const writeTagErr = new Error(`TIMEOUT occurred while writing Writing Tag: ${tag.name}.`);

        // Wait for Response
        await promiseTimeout(
            new Promise((resolve, reject) => {

                // Full Tag Writing
                this.on("Write Tag", (err, data) => {
                    if (err) reject(err);

                    tag.unstageWriteRequest();
                    resolve(data);
                });

                // Masked Bit Writing
                this.on("Read Modify Write Tag", (err, data) => {
                    if (err) reject(err);

                    tag.unstageWriteRequest();
                    resolve(data);
                });
            }),
            10000,
            writeTagErr
        );

        this.removeAllListeners("Write Tag");
        this.removeAllListeners("Read Modify Write Tag");
    }

    /**
     * Reads All Tags in the Passed Tag Group
     *
     * @param {TagGroup} group
     * @returns {Promise}
     * @memberof Controller
     */
    async _readTagGroup(group) {
        group.setController(this);

        const messages = group.generateReadMessageRequests();

        const readTagGroupErr = new Error("TIMEOUT occurred while writing Reading Tag Group.");

        // Send Each Multi Service Message
        for (let msg of messages) {
            this.write_cip(msg.data);

            // Wait for Controller to Respond
            const data = await promiseTimeout(
                new Promise((resolve, reject) => {
                    this.on("Multiple Service Packet", (err, data) => {
                        if (err) reject(err);

                        resolve(data);
                    });
                }),
                10000,
                readTagGroupErr
            );

            this.removeAllListeners("Multiple Service Packet");

            // Parse Messages
            group.parseReadMessageResponses(data, msg.tag_ids);
        }
    }

    /**
     * Writes to Tag Group Tags
     *
     * @param {TagGroup} group
     * @returns {Promise}
     * @memberof Controller
     */
    async _writeTagGroup(group) {
        group.setController(this);

        const messages = group.generateWriteMessageRequests();

        const writeTagGroupErr = new Error("TIMEOUT occurred while writing Reading Tag Group.");

        // Send Each Multi Service Message
        for (let msg of messages) {
            this.write_cip(msg.data);

            // Wait for Controller to Respond
            const data = await promiseTimeout(
                new Promise((resolve, reject) => {
                    this.on("Multiple Service Packet", (err, data) => {
                        if (err) reject(err);

                        resolve(data);
                    });
                }),
                10000,
                writeTagGroupErr
            );

            this.removeAllListeners("Multiple Service Packet");

            group.parseWriteMessageRequests(data, msg.tag_ids);
        }
    }
    // endregion

    // region Event Handlers
    /**
     * @typedef EncapsulationData
     * @type {Object}
     * @property {number} commandCode - Ecapsulation Command Code
     * @property {string} command - Encapsulation Command String Interpretation
     * @property {number} length - Length of Encapsulated Data
     * @property {number} session - Session ID
     * @property {number} statusCode - Status Code
     * @property {string} status - Status Code String Interpretation
     * @property {number} options - Options (Typically 0x00)
     * @property {Buffer} data - Encapsulated Data Buffer
     */
    /*****************************************************************/

    /**
     * @typedef MessageRouter
     * @type {Object}
     * @property {number} service - Reply Service Code
     * @property {number} generalStatusCode - General Status Code (Vol 1 - Appendix B)
     * @property {number} extendedStatusLength - Length of Extended Status (In 16-bit Words)
     * @property {Array} extendedStatus - Extended Status
     * @property {Buffer} data - Status Code
     */
    /*****************************************************************/

    /**
     * Handles SendRRData Event Emmitted by Parent and Routes
     * incoming Message
     *
     * @param {Array} srrd - Array of Common Packet Formatted Objects
     * @memberof Controller
     */
    _handleSendRRDataReceived(srrd) {
        const { service, generalStatusCode, extendedStatus, data } = CIP.MessageRouter.parse(
            srrd[1].data
        );

        const {
            GET_ATTRIBUTE_SINGLE,
            GET_ATTRIBUTE_ALL,
            SET_ATTRIBUTE_SINGLE,
            SET_ATTRIBUTE_ALL,
            READ_TAG,
            READ_TAG_FRAGMENTED,
            WRITE_TAG,
            WRITE_TAG_FRAGMENTED,
            READ_MODIFY_WRITE_TAG,
            MULTIPLE_SERVICE_PACKET,
            GET_INSTANCE_ATTRIBUTE_LIST,
            FORWARD_OPEN,
            FORWARD_CLOSE,
            GET_ATTRIBUTE_LIST,
            READ_TEMPLATE,
        } = CIP.MessageRouter.services;

        let error = generalStatusCode !== 0 ? { generalStatusCode, extendedStatus } : null;

        // Route Incoming Message Responses
        /* eslint-disable indent */
        switch (service - 0x80) {
            case READ_TEMPLATE:
                this.emit("Read Template", error, data);
                this.emit("Read Tag", error, data);
                break;
            case GET_ATTRIBUTE_LIST:
                this.emit("Get Attribute List", error, data);
                break;
            case GET_INSTANCE_ATTRIBUTE_LIST:
                this.emit("Get Instance Attribute List", error, data);
                break;
            case FORWARD_CLOSE:
                this.emit("Forward Close", error, data);
                break;
            case FORWARD_OPEN:
                this.emit("Forward Open", error, data);
                break;
            case GET_ATTRIBUTE_SINGLE:
                this.emit("Get Attribute Single", error, data);
                break;
            case GET_ATTRIBUTE_ALL:
                this.emit("Get Attribute All", error, data);
                break;
            case SET_ATTRIBUTE_SINGLE:
                this.emit("Set Attribute Single", error, data);
                break;
            case SET_ATTRIBUTE_ALL:
                this.emit("Set Attribute All", error, data);
                break;
            case READ_TAG:
                this.emit("Read Tag", error, data);
                break;
            case READ_TAG_FRAGMENTED:
                this.emit("Read Tag Fragmented", error, data);
                break;
            case WRITE_TAG:
                this.emit("Write Tag", error, data);
                break;
            case WRITE_TAG_FRAGMENTED:
                this.emit("Write Tag Fragmented", error, data);
                break;
            case READ_MODIFY_WRITE_TAG:
                this.emit("Read Modify Write Tag", error, data);
                break;
            case MULTIPLE_SERVICE_PACKET: {
                // If service errored then propogate error
                if (error) {
                    this.emit("Multiple Service Packet", error, data);
                    break;
                }

                // Get Number of Services to be Enclosed
                let services = data.readUInt16LE(0);
                let offsets = [];
                let responses = [];

                // Build Array of Buffer Offsets
                for (let i = 0; i < services; i++) {
                    offsets.push(data.readUInt16LE(i * 2 + 2));
                }

                // Gather Messages within Buffer
                for (let i = 0; i < offsets.length - 1; i++) {
                    const length = offsets[i + 1] - offsets[i];

                    let buf = Buffer.alloc(length);
                    data.copy(buf, 0, offsets[i], offsets[i + 1]);

                    // Parse Message Data
                    const msgData = CIP.MessageRouter.parse(buf);

                    if (msgData.generalStatusCode !== 0) {
                        error = {
                            generalStatusCode: msgData.generalStatusCode,
                            extendedStatus: msgData.extendedStatus
                        };
                    }

                    responses.push(msgData);
                }

                // Handle Final Message
                const length = data.length - offsets[offsets.length - 1];

                let buf = Buffer.alloc(length);
                data.copy(buf, 0, offsets[offsets.length - 1]);

                const msgData = CIP.MessageRouter.parse(buf);

                if (msgData.generalStatusCode !== 0) {
                    error = {
                        generalStatusCode: msgData.generalStatusCode,
                        extendedStatus: msgData.extendedStatus
                    };
                }

                responses.push(msgData);

                this.emit("Multiple Service Packet", error, responses);
                break;
            }
            default:
                this.emit("Unknown Reply", { generalStatusCode: 0x99, extendedStatus: [] }, data);
                break;
        }
        /* eslint-enable indent */
    }

    _handleSendUnitDataReceived(sud) {
        let sudnew = sud[1].data.slice(2); // First 2 bytes are Connection sequence number
        const { service, generalStatusCode, extendedStatus, data } = CIP.MessageRouter.parse(
            sudnew
        );

        const {
            GET_ATTRIBUTE_SINGLE,
            GET_ATTRIBUTE_ALL,
            GET_INSTANCE_ATTRIBUTE_LIST,
            SET_ATTRIBUTE_SINGLE,
            SET_ATTRIBUTE_ALL,
            READ_TAG,
            READ_TAG_FRAGMENTED,
            WRITE_TAG,
            WRITE_TAG_FRAGMENTED,
            READ_MODIFY_WRITE_TAG,
            MULTIPLE_SERVICE_PACKET,
            FORWARD_OPEN,
            FORWARD_CLOSE,
            GET_ATTRIBUTE_LIST,
            READ_TEMPLATE,

        } = CIP.MessageRouter.services;

        let error = generalStatusCode !== 0 ? { generalStatusCode, extendedStatus } : null;

        // Route Incoming Message Responses
        /* eslint-disable indent */
        switch (service - 0x80) {
            case READ_TEMPLATE:
                this.emit("Read Tag", error, data);
                this.emit("Read Template", error, data);
                break;
            case GET_ATTRIBUTE_LIST:
                this.emit("Get Attribute List", error, data);
                break;
            case FORWARD_CLOSE:
                this.emit("Forward Close", error, data);
                break;
            case FORWARD_OPEN:
                this.emit("Forward Open", error, data);
                break;
            case GET_ATTRIBUTE_SINGLE:
                this.emit("Get Attribute Single", error, data);
                break;
            case GET_ATTRIBUTE_ALL:
                this.emit("Get Attribute All", error, data);
                break;
            case SET_ATTRIBUTE_ALL:
                this.emit("Set Attribute All", error, data);
                break;
            case SET_ATTRIBUTE_SINGLE:
                this.emit("Set Attribute Single", error, data);
                break;
            case GET_INSTANCE_ATTRIBUTE_LIST:
                this.emit("Get Instance Attribute List", error, data);
                break;
            case READ_TAG:
                this.emit("Read Tag", error, data);
                break;
            case READ_TAG_FRAGMENTED:
                this.emit("Read Tag Fragmented", error, data);
                break;
            case WRITE_TAG:
                this.emit("Write Tag", error, data);
                break;
            case WRITE_TAG_FRAGMENTED:
                this.emit("Write Tag Fragmented", error, data);
                break;
            case READ_MODIFY_WRITE_TAG:
                this.emit("Read Modify Write Tag", error, data);
                break;
            case MULTIPLE_SERVICE_PACKET: {
                // If service errored then propogate error
                if (error) {
                    this.emit("Multiple Service Packet", error, data);
                    break;
                }

                // Get Number of Services to be Enclosed
                let services = data.readUInt16LE(0);
                let offsets = [];
                let responses = [];

                // Build Array of Buffer Offsets
                for (let i = 0; i < services; i++) {
                    offsets.push(data.readUInt16LE(i * 2 + 2));
                }

                // Gather Messages within Buffer
                for (let i = 0; i < offsets.length - 1; i++) {
                    const length = offsets[i + 1] - offsets[i];

                    let buf = Buffer.alloc(length);
                    data.copy(buf, 0, offsets[i], offsets[i + 1]);

                    // Parse Message Data
                    const msgData = CIP.MessageRouter.parse(buf);

                    if (msgData.generalStatusCode !== 0) {
                        error = {
                            generalStatusCode: msgData.generalStatusCode,
                            extendedStatus: msgData.extendedStatus
                        };
                    }

                    responses.push(msgData);
                }

                // Handle Final Message
                const length = data.length - offsets[offsets.length - 1];

                let buf = Buffer.alloc(length);
                data.copy(buf, 0, offsets[offsets.length - 1]);

                const msgData = CIP.MessageRouter.parse(buf);

                if (msgData.generalStatusCode !== 0) {
                    error = {
                        generalStatusCode: msgData.generalStatusCode,
                        extendedStatus: msgData.extendedStatus
                    };
                }

                responses.push(msgData);

                this.emit("Multiple Service Packet", error, responses);
                break;
            }
            default:
                this.emit("Unknown Reply", { generalStatusCode: 0x99, extendedStatus: [] }, data);
                break;
        }
        /* eslint-enable indent */
    }

    // _handleSessionRegistrationFailed(error) {
    //     // TODO: Implement Handler if Necessary
    // }
    // endregion
}

module.exports = Controller;
