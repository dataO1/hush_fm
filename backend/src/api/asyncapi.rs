use axum::{
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use crate::asyncapi::{generate_asyncapi_spec, serialize_to_json, serialize_to_yaml};

/// AsyncAPI spec in JSON format
pub async fn asyncapi_json() -> impl IntoResponse {
    match generate_asyncapi_spec() {
        Ok(spec) => match serialize_to_json(&spec) {
            Ok(json) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/json")],
                json,
            )
                .into_response(),
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize AsyncAPI spec: {}", err),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to generate AsyncAPI spec: {}", err),
        )
            .into_response(),
    }
}

/// AsyncAPI spec in YAML format
pub async fn asyncapi_yaml() -> impl IntoResponse {
    match generate_asyncapi_spec() {
        Ok(spec) => match serialize_to_yaml(&spec) {
            Ok(yaml) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/x-yaml")],
                yaml,
            )
                .into_response(),
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to serialize AsyncAPI spec: {}", err),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to generate AsyncAPI spec: {}", err),
        )
            .into_response(),
    }
}



/// Create AsyncAPI router
pub fn asyncapi_router() -> Router {
    Router::new()
        .route("/asyncapi.json", get(asyncapi_json))
        .route("/asyncapi.yaml", get(asyncapi_yaml))
}