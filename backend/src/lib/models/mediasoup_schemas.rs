/**
 * JsonSchema implementations for MediaSoup types
 * 
 * MediaSoup types implement Serialize/Deserialize but not JsonSchema.
 * This module provides JsonSchema implementations that match MediaSoup's actual serialization format.
 * Used with serde_with::Schema to enable OpenAPI schema generation for native MediaSoup types.
 */

use schemars::{JsonSchema, gen::SchemaGenerator, schema::{Schema, SchemaObject, ObjectValidation}};
use serde_json::Value;
use std::collections::BTreeMap;
use serde_with::schemars_0_8::JsonSchemaAs;
use serde_with::{SerializeAs, DeserializeAs};
use serde::{Serializer, Deserializer};

/// JsonSchema implementation for MediaSoup's RtpParameters type
/// 
/// MediaSoup's RtpParameters contains codec information, encoding parameters,
/// header extensions, and RTCP configuration for WebRTC media streams.
pub struct MediaSoupRtpParameters;

impl JsonSchema for MediaSoupRtpParameters {
    fn schema_name() -> String {
        "RtpParameters".to_owned()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        let mut properties = BTreeMap::new();
        
        // mid: Optional media identifier
        properties.insert(
            "mid".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::String))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Media identifier for this RTP stream".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        // codecs: Array of RTP codec parameters
        properties.insert(
            "codecs".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                array: Some(Box::new(schemars::schema::ArrayValidation {
                    items: Some(schemars::schema::SingleOrVec::Single(Box::new(Schema::Object(SchemaObject {
                        instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
                        object: Some(Box::new(ObjectValidation {
                            properties: {
                                let mut codec_props = BTreeMap::new();
                                codec_props.insert("mimeType".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::String))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("MIME type of the codec (e.g., 'audio/opus')".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props.insert("payloadType".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Integer))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("RTP payload type identifier".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props.insert("clockRate".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Integer))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("Sampling rate in Hz".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props.insert("channels".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Integer))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("Number of audio channels (for audio codecs)".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props.insert("parameters".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("Codec-specific parameters".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props.insert("rtcpFeedback".to_owned(), Schema::Object(SchemaObject {
                                    instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                                    metadata: Some(Box::new(schemars::schema::Metadata {
                                        description: Some("RTCP feedback mechanisms".to_owned()),
                                        ..Default::default()
                                    })),
                                    ..Default::default()
                                }));
                                codec_props
                            },
                            required: {
                                let mut required = std::collections::BTreeSet::new();
                                required.insert("mimeType".to_owned());
                                required.insert("payloadType".to_owned());
                                required.insert("clockRate".to_owned());
                                required
                            },
                            ..Default::default()
                        })),
                        metadata: Some(Box::new(schemars::schema::Metadata {
                            description: Some("RTP codec parameters".to_owned()),
                            ..Default::default()
                        })),
                        ..Default::default()
                    })))),
                    ..Default::default()
                })),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Array of supported RTP codecs".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        // headerExtensions: Array of RTP header extensions
        properties.insert(
            "headerExtensions".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("RTP header extensions for additional metadata".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        // encodings: Array of RTP encoding parameters
        properties.insert(
            "encodings".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("RTP encoding parameters (SSRC, DTX, etc.)".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        // rtcp: RTCP configuration
        properties.insert(
            "rtcp".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("RTCP configuration parameters".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        Schema::Object(SchemaObject {
            instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
            object: Some(Box::new(ObjectValidation {
                properties,
                required: {
                    let mut required = std::collections::BTreeSet::new();
                    required.insert("codecs".to_owned());
                    required.insert("headerExtensions".to_owned());
                    required.insert("encodings".to_owned());
                    required
                },
                ..Default::default()
            })),
            metadata: Some(Box::new(schemars::schema::Metadata {
                title: Some("RTP Parameters".to_owned()),
                description: Some("Real-time Transport Protocol parameters for media consumption. Contains codec information, encoding parameters, header extensions, and RTCP configuration.".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        })
    }
}

/// JsonSchema implementation for MediaSoup's RtpCapabilities type
/// 
/// RtpCapabilities describe what codecs and features a MediaSoup router or client supports.
/// Used for capability negotiation between DJ and listeners.
pub struct MediaSoupRtpCapabilities;

impl JsonSchema for MediaSoupRtpCapabilities {
    fn schema_name() -> String {
        "RtpCapabilities".to_owned()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        let mut properties = BTreeMap::new();
        
        properties.insert(
            "codecs".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Supported codecs with their capabilities".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        properties.insert(
            "headerExtensions".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Supported RTP header extensions".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        properties.insert(
            "fecMechanisms".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Forward Error Correction mechanisms".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        Schema::Object(SchemaObject {
            instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
            object: Some(Box::new(ObjectValidation {
                properties,
                required: {
                    let mut required = std::collections::BTreeSet::new();
                    required.insert("codecs".to_owned());
                    required.insert("headerExtensions".to_owned());
                    required
                },
                ..Default::default()
            })),
            metadata: Some(Box::new(schemars::schema::Metadata {
                title: Some("RTP Capabilities".to_owned()),
                description: Some("RTP capabilities describing supported codecs and features for media negotiation between peers.".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        })
    }
}

/// JsonSchema implementation for MediaSoup's DtlsParameters type
/// 
/// DTLS parameters for secure WebRTC transport connection establishment.
pub struct MediaSoupDtlsParameters;

impl JsonSchema for MediaSoupDtlsParameters {
    fn schema_name() -> String {
        "DtlsParameters".to_owned()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        let mut properties = BTreeMap::new();
        
        properties.insert(
            "role".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::String))),
                enum_values: Some(vec![
                    Value::String("auto".to_owned()),
                    Value::String("client".to_owned()),
                    Value::String("server".to_owned())
                ]),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("DTLS role for connection establishment".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        properties.insert(
            "fingerprints".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Array))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Certificate fingerprints for DTLS verification".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        Schema::Object(SchemaObject {
            instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
            object: Some(Box::new(ObjectValidation {
                properties,
                required: {
                    let mut required = std::collections::BTreeSet::new();
                    required.insert("role".to_owned());
                    required.insert("fingerprints".to_owned());
                    required
                },
                ..Default::default()
            })),
            metadata: Some(Box::new(schemars::schema::Metadata {
                title: Some("DTLS Parameters".to_owned()),
                description: Some("Datagram Transport Layer Security parameters for secure WebRTC connection establishment.".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        })
    }
}

/// JsonSchema implementation for MediaSoup's IceParameters type
/// 
/// ICE parameters for WebRTC connectivity establishment.
pub struct MediaSoupIceParameters;

impl JsonSchema for MediaSoupIceParameters {
    fn schema_name() -> String {
        "IceParameters".to_owned()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        let mut properties = BTreeMap::new();
        
        properties.insert(
            "usernameFragment".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::String))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("ICE username fragment for authentication".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        properties.insert(
            "password".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::String))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("ICE password for authentication".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        properties.insert(
            "iceLite".to_owned(),
            Schema::Object(SchemaObject {
                instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Boolean))),
                metadata: Some(Box::new(schemars::schema::Metadata {
                    description: Some("Whether ICE lite mode is enabled".to_owned()),
                    ..Default::default()
                })),
                ..Default::default()
            })
        );

        Schema::Object(SchemaObject {
            instance_type: Some(schemars::schema::SingleOrVec::Single(Box::new(schemars::schema::InstanceType::Object))),
            object: Some(Box::new(ObjectValidation {
                properties,
                required: {
                    let mut required = std::collections::BTreeSet::new();
                    required.insert("usernameFragment".to_owned());
                    required.insert("password".to_owned());
                    required
                },
                ..Default::default()
            })),
            metadata: Some(Box::new(schemars::schema::Metadata {
                title: Some("ICE Parameters".to_owned()),
                description: Some("Interactive Connectivity Establishment parameters for WebRTC peer connection setup.".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        })
    }
}

/// Implement SerializeAs trait for MediaSoupRtpParameters
impl<T> SerializeAs<T> for MediaSoupRtpParameters 
where
    T: serde::Serialize,
{
    fn serialize_as<S>(source: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        source.serialize(serializer)
    }
}

/// Implement DeserializeAs trait for MediaSoupRtpParameters
impl<'de, T> DeserializeAs<'de, T> for MediaSoupRtpParameters
where
    T: serde::Deserialize<'de>,
{
    fn deserialize_as<D>(deserializer: D) -> Result<T, D::Error>
    where
        D: Deserializer<'de>,
    {
        T::deserialize(deserializer)
    }
}

/// Implement JsonSchemaAs trait for MediaSoupRtpParameters
impl<T> JsonSchemaAs<T> for MediaSoupRtpParameters {
    fn schema_name() -> String {
        <Self as JsonSchema>::schema_name()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        <Self as JsonSchema>::json_schema(_gen)
    }
}

/// Implement SerializeAs trait for MediaSoupRtpCapabilities
impl<T> SerializeAs<T> for MediaSoupRtpCapabilities 
where
    T: serde::Serialize,
{
    fn serialize_as<S>(source: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        source.serialize(serializer)
    }
}

/// Implement DeserializeAs trait for MediaSoupRtpCapabilities
impl<'de, T> DeserializeAs<'de, T> for MediaSoupRtpCapabilities
where
    T: serde::Deserialize<'de>,
{
    fn deserialize_as<D>(deserializer: D) -> Result<T, D::Error>
    where
        D: Deserializer<'de>,
    {
        T::deserialize(deserializer)
    }
}

/// Implement JsonSchemaAs trait for MediaSoupRtpCapabilities
impl<T> JsonSchemaAs<T> for MediaSoupRtpCapabilities {
    fn schema_name() -> String {
        <Self as JsonSchema>::schema_name()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        <Self as JsonSchema>::json_schema(_gen)
    }
}

/// Implement SerializeAs trait for MediaSoupDtlsParameters
impl<T> SerializeAs<T> for MediaSoupDtlsParameters 
where
    T: serde::Serialize,
{
    fn serialize_as<S>(source: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        source.serialize(serializer)
    }
}

/// Implement DeserializeAs trait for MediaSoupDtlsParameters
impl<'de, T> DeserializeAs<'de, T> for MediaSoupDtlsParameters
where
    T: serde::Deserialize<'de>,
{
    fn deserialize_as<D>(deserializer: D) -> Result<T, D::Error>
    where
        D: Deserializer<'de>,
    {
        T::deserialize(deserializer)
    }
}

/// Implement JsonSchemaAs trait for MediaSoupDtlsParameters
impl<T> JsonSchemaAs<T> for MediaSoupDtlsParameters {
    fn schema_name() -> String {
        <Self as JsonSchema>::schema_name()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        <Self as JsonSchema>::json_schema(_gen)
    }
}

/// Implement SerializeAs trait for MediaSoupIceParameters
impl<T> SerializeAs<T> for MediaSoupIceParameters 
where
    T: serde::Serialize,
{
    fn serialize_as<S>(source: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        source.serialize(serializer)
    }
}

/// Implement DeserializeAs trait for MediaSoupIceParameters
impl<'de, T> DeserializeAs<'de, T> for MediaSoupIceParameters
where
    T: serde::Deserialize<'de>,
{
    fn deserialize_as<D>(deserializer: D) -> Result<T, D::Error>
    where
        D: Deserializer<'de>,
    {
        T::deserialize(deserializer)
    }
}

/// Implement JsonSchemaAs trait for MediaSoupIceParameters
impl<T> JsonSchemaAs<T> for MediaSoupIceParameters {
    fn schema_name() -> String {
        <Self as JsonSchema>::schema_name()
    }

    fn json_schema(_gen: &mut SchemaGenerator) -> Schema {
        <Self as JsonSchema>::json_schema(_gen)
    }
}