'use strict';

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
	Schema = mongoose.Schema,
	_ = require('lodash'),
	config = require('../../config/config'),
	path = require('path'),
	mUtilities = require('mongoose-utilities'),
	fs = require('fs-extra'),
	async = require('async'),
	mkdirp = require('mkdirp'),
	Random = require('random-js'),
	mt = Random.engines.mt19937(),
	util = require('util');

mt.autoSeed();

//Mongoose Models
var FieldSchema = require('./form_field.server.model.js');
var Field = mongoose.model('Field');

var FormSubmissionSchema = require('./form_submission.server.model.js'),
	FormSubmission = mongoose.model('FormSubmission', FormSubmissionSchema);


var ButtonSchema = new Schema({
	url: {
		type: String,
		match: [/((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)/],
	},
	action: String,
	text: String,
	bgColor: {
		type: String,
		match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
		default: '#5bc0de'
	},
	color: {
		type: String,
		match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
		default: '#ffffff'
	}
});

var VisitorDataSchema = new Schema({
	referrer: {
		type: String
	},
	lastActiveField: {
		type: Schema.Types.ObjectId
	},
	timeElapsed: {
		type: Number
	},
	isSubmitted: {
		type: Boolean
	},
	language: {
		type: String
	},
	ipAddr: {
		type: String,
		default: ''
	},
	deviceType: {
		type: String,
		enum: ['desktop', 'phone', 'tablet', 'other'],
		default: 'other'
	},
	userAgent: {
		type: String
	}

});

var formSchemaOptions = {
	toJSON: {
		virtuals: true
	}
};

/**
 * Form Schema
 */
var FormSchema = new Schema({
	title: {
		type: String,
		trim: true,
		required: 'Form Title cannot be blank'
	},
	language: {
		type: String,
		enum: ['en', 'fr', 'es', 'it', 'de'],
		default: 'en',
		required: 'Form must have a language'
	},
	analytics:{
		gaCode: {
			type: String
		},
		visitors: [VisitorDataSchema]
	},

	form_fields: [FieldSchema],
	submissions: [{
		type: Schema.Types.ObjectId,
		ref: 'FormSubmission'
	}],

	admin: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: 'Form must have an Admin'
	},
	startPage: {
		showStart:{
			type: Boolean,
			default: false
		},
		introTitle:{
			type: String,
			default: 'Welcome to Form'
		},
		introParagraph:{
			type: String
		},
        introButtonText:{
            type: String,
            default: 'Start'
        },
		buttons:[ButtonSchema]
	},

	hideFooter: {
		type: Boolean,
		default: false
	},
	isLive: {
		type: Boolean,
		default: false
	},

	design: {
		colors:{
			backgroundColor: {
				type: String,
				match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
				default: '#fff'
			},
			questionColor: {
				type: String,
				match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
				default: '#333'
			},
			answerColor: {
				type: String,
				match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
				default: '#333'
			},
			buttonColor: {
				type: String,
				match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
			    default: '#fff'
            },
            buttonTextColor: {
                type: String,
                match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/],
                default: '#333'
            }
		},
		font: String
	}
}, formSchemaOptions);

/*
** In-Form Analytics Virtual Attributes
 */
FormSchema.virtual('analytics.views').get(function () {
	if(this.analytics && this.analytics.visitors && this.analytics.visitors.length > 0){
		return this.analytics.visitors.length;
	} else {
		return 0;
	}
});

FormSchema.virtual('analytics.submissions').get(function () {
	return this.submissions.length;
});

FormSchema.virtual('analytics.conversionRate').get(function () {
	if(this.analytics && this.analytics.visitors && this.analytics.visitors.length > 0){
		return this.submissions.length/this.analytics.visitors.length*100;
	} else {
		return 0;
	}
});

FormSchema.virtual('analytics.fields').get(function () {
	var fieldDropoffs = [];
	var visitors = this.analytics.visitors;
	var that = this;

	if(this.form_fields.length == 0) return null;
	for(var i=0; i<this.form_fields.length; i++){
		var field = this.form_fields[i];

		if(field && !field.deletePreserved){

			var dropoffViews =  _.reduce(visitors, function(sum, visitorObj){

					if(visitorObj.lastActiveField+'' === field._id+'' && !visitorObj.isSubmitted){
						return sum + 1;
					}
					return sum;
				}, 0);

			var continueViews, nextIndex;

			if(i !== this.form_fields.length-1){
				continueViews =  _.reduce(visitors, function(sum, visitorObj){
					nextIndex = that.form_fields.indexOf(_.find(that.form_fields, function(o) {
						return o._id+'' === visitorObj.lastActiveField+'';
					}));

					if(nextIndex > i){
						return sum + 1;
					}
					return sum;
				}, 0);
			} else {
				continueViews =  _.reduce(visitors, function(sum, visitorObj){
					if(visitorObj.lastActiveField+'' === field._id+'' && visitorObj.isSubmitted){
						return sum + 1;
					}
					return sum;
				}, 0);

			}

			var totalViews = dropoffViews+continueViews;
			var responses = continueViews;
			var continueRate = (continueViews/totalViews*100).toFixed(0);
			var dropoffRate = (dropoffViews/totalViews*100).toFixed(0);

			fieldDropoffs[i] = {
				dropoffViews: dropoffViews,
				responses: continueViews,
				totalViews: totalViews,
				continueRate: continueRate,
				dropoffRate: dropoffRate,
				field: field
			};

		}
	}

	return fieldDropoffs;
});

FormSchema.plugin(mUtilities.timestamp, {
	createdPath: 'created',
	modifiedPath: 'lastModified',
	useVirtual: false
});

var _original;

function getDeletedIndexes(needle, haystack){
	var deletedIndexes = [];

	if(haystack.length > 0){
	  	for(var i = 0; i < needle.length; i++){
	    	if(haystack.indexOf(needle[i]) === -1){
				deletedIndexes.push(i);
	    	}
	  	}
	}
	return deletedIndexes;
}


FormSchema.pre('save', function (next) {
	var that = this;
	switch(this.language){
		case 'spanish':
			this.language = 'es';
			break;
		case 'french':
			this.language = 'fr';
			break;
		case 'italian':
			this.language = 'it';
			break;
		case 'german':
			this.language = 'de';
			break;
		default:
			this.language = 'en';
			break;
	}
	next();
});

FormSchema.pre('save', function (next) {
	var that = this;

	async.series([function(cb) {
		that.constructor
			.findOne({_id: that._id}).exec(function (err, original) {
			if (err) {
				console.log(err);
				return cb(err);
			} else {
				_original = original;
				return cb(null);
			}
		});
	},
	function(cb) {
		var hasIds = true;
		for(var i=0; i<that.form_fields.length; i++){
			if(!that.form_fields.hasOwnProperty('_id')){
				hasIds = false;
				break;
			}
		}
		if(that.isModified('form_fields') && that.form_fields && _original && hasIds){

			var old_form_fields = _original.form_fields,
				new_ids = _.map(_.pluck(that.form_fields, 'id'), function(id){ return ''+id;}),
				old_ids = _.map(_.pluck(old_form_fields, 'id'), function(id){ return ''+id;}),
				deletedIds = getDeletedIndexes(old_ids, new_ids);

			//Preserve fields that have at least one submission
			if( deletedIds.length > 0 ){

				var modifiedSubmissions = [];

				async.forEachOfSeries(deletedIds,
					function (deletedIdIndex, key, cb_id) {

						var deleted_id = old_ids[deletedIdIndex];

						//Find FormSubmissions that contain field with _id equal to 'deleted_id'
						FormSubmission.
						find({ form: that._id, admin: that.admin, form_fields: {$elemMatch: {submissionId: deleted_id} }  }).
						exec(function(err, submissions){
							if(err) {
								console.error(err);
								return cb_id(err);
							} else {
								//Delete field if there are no submission(s) found
								if (submissions.length) {
									//Add submissions
									modifiedSubmissions.push.apply(modifiedSubmissions, submissions);
								}

								return cb_id(null);
							}
						});
					},
					function (err) {
						if(err){
							console.error(err.message);
							return cb(err);
						} else {

							//Iterate through all submissions with modified form_fields
							async.forEachOfSeries(modifiedSubmissions, function (submission, key, callback) {

								//Iterate through ids of deleted fields
								for (var i = 0; i < deletedIds.length; i++) {

									var index = _.findIndex(submission.form_fields, function (field) {
										var tmp_id = field._id + '';
										return tmp_id === old_ids[deletedIds[i]];
									});

									var deletedField = submission.form_fields[index];

									//Hide field if it exists
									if (deletedField) {
										// console.log('deletedField\n-------\n\n');
										// console.log(deletedField);
										//Delete old form_field
										submission.form_fields.splice(index, 1);

										deletedField.deletePreserved = true;

										//Move deleted form_field to start
										submission.form_fields.unshift(deletedField);
										that.form_fields.unshift(deletedField);
										// console.log('form.form_fields\n--------\n\n');
										// console.log(that.form_fields);
									}
								}

								submission.save(function (err) {
									if (err) return callback(err);
									else return callback(null);
								});
							}, function (err) {
								if (err) {
									console.error(err.message);
									return cb(err);
								}
								else return cb();
							});
						}
					}
				);
			}
			else return cb(null);
		}
		else return cb(null);
	}],
	function(err, results){
		if (err) return next(err);
		return next();
	});
});

mongoose.model('Form', FormSchema);

