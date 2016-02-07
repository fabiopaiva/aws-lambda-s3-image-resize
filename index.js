var gm = require('gm').subClass({
    imageMagick: true
})
var AWS = require('aws-sdk');
var path = require('path');
var s3 = new AWS.S3();

var outputs = [{
    width: 1000,
    destinationPath: "large"
}, {
    width: 640,
    destinationPath: "medium"
}, {
    width: 200,
    destinationPath: "small"
}, {
    width: 220,
    destinationPath: "220px"
}, {
    width: 78,
    destinationPath: "78px"
}, {
    width: 45,
    destinationPath: "thumbnail"
}];

exports.handler = function(event, context) {
    console.log('Start handler');
    resizeImage.context = context;
    resizeImage.outputs = outputs;

    var record = event.Records[0];
    var srcBucket = record.s3.bucket.name;
    var dstBucket = srcBucket + "-output";
    var srcKey = record.s3.object.key.replace(/\+/g, " ");
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    var fileName = path.basename(srcKey);
    var dirname = path.dirname(srcKey);
    var imageType = typeMatch[1].toLowerCase();

    resizeImage.options = {
        'srcBucket': srcBucket,
        'dstBucket': dstBucket,
        'srcKey': srcKey,
        'typeMatch': typeMatch,
        'fileName': fileName,
        'dirname': dirname,
        'imageType': imageType
    };

    if (!resizeImage.checkRequirements()) return;
    resizeImage.process();
};

var resizeImage = {
    context: null,
    options: {},
    outputs: [],
    uploadCount: 0,
    checkRequirements: function() {
        console.log('Checking requirements');
        if (!this.options.typeMatch) {
            console.error('Unable to infer image type for key ' + this.options.srcKey);
            return;
        }
        if (this.options.imageType != "jpg" && this.options.imageType != "gif" && this.options.imageType != "png" && this.options.imageType != "eps") {
            console.log('Skipping non-image ' + this.options.srcKey);
            return;
        }
        return true;
    },
    process: function() {
        var _self = resizeImage;
        console.time('Proccess');
        console.log('Downloading file', _self.options.srcKey);
        s3.getObject({
            Bucket: this.options.srcBucket,
            Key: this.options.srcKey
        }, _self.getS3Response);
    },
    getS3Response: function(err, data) {
        var _self = resizeImage;
        if (err) {
            console.log('error', err, err.stack);
            _self.context.fail(err);
        } else {
            try {
                for (var i in _self.outputs) {
                    (function(index) {
                        var output = _self.outputs[index];
                        console.log('Prepare to resize: ', output.width + 'px');
                        console.time('Resized ' + output.width + 'px');
                        gm(data.Body).resize(output.width).toBuffer(
                            _self.options.imageType,
                            function(err, buffer){
                             _self.resizeResponse(err, buffer, output)   
                            }
                        );
                    })(i);
                }
            } catch (err) {
                console.log('Resize operation failed:', err);
                _self.context.fail(err);
            }

        }
    },
    resizeResponse: function(err, buffer, output) {
        var _self = resizeImage;
        if (err) {
            console.log('Resize operation failed:', err);
            throw err;
        } else {
            console.timeEnd('Resized ' + output.width + 'px');
            console.time('Upload' + output.width + 'px');
            s3.putObject({
                Bucket: _self.options.dstBucket,
                Key: 'images/' + output.destinationPath + '/' + _self.options.fileName,
                Body: buffer,
                ContentType: 'image/' + _self.options.imageType
            }, function(err, data) {
                _self.putS3Response(err, data, output);
            });
        }
    },
    putS3Response: function(err, data, output) {
        if (err) {
            console.log('Error uploading to bucket', err, err.stack); // an error occurred
            throw err;
        } else {
            console.timeEnd('Upload' + output.width + 'px');
            var _self = resizeImage;
            _self.uploadCount++;
            if (_self.uploadCount == _self.outputs.length) {
                console.timeEnd('Proccess');
                _self.context.succeed('Resize success');
            }
        }
    }
};