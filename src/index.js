const Controller = require("./controller");
const pcccTag = require("./pcccTag");
const TagGroup = require("./tag-group");
const EthernetIP = require("./enip");
const util = require("./utilities");

const barTag = new pcccTag("N7:0"); // Program Scope Tag in PLC Program "prog"
const PLC = new Controller();
PLC.connect("192.168.1.11", 0).then(async () => {
    await PLC.writeTag(barTag,8811);
    console.log("Trying to write 8811 to the tag, actual value:\n");
    await PLC.readTag(barTag);
    console.log(barTag.name+"->"+barTag.value);
});
module.exports = { Controller, pcccTag, TagGroup, EthernetIP, util };
