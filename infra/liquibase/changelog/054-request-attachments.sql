--liquibase formatted sql

-- Attachments on request messages: files stored like every other upload (documents, DocumentsService),
-- linked to the message they were sent with. Access goes through the message's request.
-- A message may now be only attachments, so its text is no longer required here (the API
-- requires text or at least one file).

--changeset worktime:054-request-message-documents
CREATE TABLE request_message_documents (
    message_id   UUID NOT NULL REFERENCES request_messages(id) ON DELETE CASCADE,
    document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, document_id)
);
CREATE INDEX idx_request_message_documents_document ON request_message_documents (document_id);

--changeset worktime:054-request-message-body-optional
ALTER TABLE request_messages DROP CONSTRAINT chk_request_messages_body;
